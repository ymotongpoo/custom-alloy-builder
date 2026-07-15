import type { IRBlockInstance, IRBody, IRConfig, IRValue } from "../ir/types"

export function serialize(config: IRConfig): string {
  const chunks = config.components.map((component) =>
    serializeLabeledBlock(component.type, component.label, component.body, 0),
  )

  for (const snippet of config.rawSnippets) {
    chunks.push(trimTrailingNewlines(snippet))
  }

  if (chunks.length === 0) {
    return ""
  }

  return `${chunks.join("\n\n")}\n`
}

function serializeLabeledBlock(name: string, label: string, body: IRBody, depth: number): string {
  return serializeBlock(`${name} ${quoteString(label)}`, body, depth)
}

function serializeNestedBlock(block: IRBlockInstance, depth: number): string {
  const heading = block.label === undefined ? block.name : `${block.name} ${quoteString(block.label)}`
  return serializeBlock(heading, block.body, depth)
}

function serializeBlock(heading: string, body: IRBody, depth: number): string {
  const indent = "\t".repeat(depth)
  const lines = [`${indent}${heading} {`]

  for (const [name, value] of Object.entries(body.attrs)) {
    lines.push(`${indent}\t${name} = ${serializeValue(value)}`)
  }

  for (const block of body.blocks) {
    lines.push(serializeNestedBlock(block, depth + 1))
  }

  lines.push(`${indent}}`)
  return lines.join("\n")
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
