import type { IRBlockInstance, IRBody, IRConfig, IRValue } from "../ir/types"
import type { ComponentSchema, SchemaBlock, SchemaBody } from "../schema/types"

export type SerializeSchemaMap = Record<string, ComponentSchema | undefined>

export function serialize(config: IRConfig, schemas: SerializeSchemaMap = {}): string {
  const chunks = config.components.map((component) =>
    serializeLabeledBlock(component.type, component.label, component.body, 0, schemas[component.type]?.arguments),
  )

  for (const snippet of config.rawSnippets) {
    chunks.push(trimTrailingNewlines(snippet))
  }

  if (chunks.length === 0) {
    return ""
  }

  return `${chunks.join("\n\n")}\n`
}

function serializeLabeledBlock(name: string, label: string, body: IRBody, depth: number, schemaBody?: SchemaBody): string {
  return serializeBlock(`${name} ${quoteString(label)}`, body, depth, schemaBody)
}

function serializeNestedBlock(block: IRBlockInstance, depth: number, schemaBlock?: SchemaBlock): string {
  if (schemaBlock?.enum) {
    return serializeEnumBlock(block, depth, schemaBlock)
  }
  const heading = block.label === undefined ? block.name : `${block.name} ${quoteString(block.label)}`
  return serializeBlock(heading, block.body, depth, schemaBlock?.body)
}

function serializeEnumBlock(block: IRBlockInstance, depth: number, schemaBlock: SchemaBlock): string {
  const variant = block.body.blocks[0]
  const variantSchema = variant ? findSchemaBlock(schemaBlock.body, variant.name) : undefined
  if (variant && variantSchema && Object.keys(block.body.attrs).length === 0 && block.body.blocks.length === 1) {
    const heading = `${block.name}.${variant.name}`
    return serializeBlock(heading, variant.body, depth, variantSchema.body)
  }
  const heading = block.label === undefined ? block.name : `${block.name} ${quoteString(block.label)}`
  return serializeBlock(heading, block.body, depth, schemaBlock.body)
}

function serializeBlock(heading: string, body: IRBody, depth: number, schemaBody?: SchemaBody): string {
  const indent = "\t".repeat(depth)
  const lines = [`${indent}${heading} {`]

  for (const [name, value] of Object.entries(body.attrs)) {
    lines.push(`${indent}\t${name} = ${serializeValue(value)}`)
  }

  for (const block of body.blocks) {
    lines.push(serializeNestedBlock(block, depth + 1, findSchemaBlock(schemaBody, block.name)))
  }

  lines.push(`${indent}}`)
  return lines.join("\n")
}

function findSchemaBlock(schemaBody: SchemaBody | undefined, name: string): SchemaBlock | undefined {
  return schemaBody?.blocks?.find((block) => block.name === name)
}

function serializeValue(value: IRValue): string {
  switch (value.t) {
    case "string":
      return quoteString(value.v)
    case "number":
      return String(value.v)
    case "bool":
      return String(value.v)
    case "list":
      return `[${value.v.map((item) => serializeValue(item)).join(", ")}]`
    case "map":
      return `{${Object.entries(value.v)
        .map(([key, item]) => `${quoteString(key)} = ${serializeValue(item)}`)
        .join(", ")}}`
    case "ref":
      return value.target
    case "raw":
      return value.v
  }
}

function quoteString(value: string): string {
  return JSON.stringify(value)
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "")
}
