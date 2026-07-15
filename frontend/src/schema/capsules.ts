import type { CapsuleEndpoint, ComponentSchema, SchemaBody, SchemaType } from './types'

export function canConnect(outputCapsule: string, inputCapsule: string): boolean {
  return outputCapsule === inputCapsule || inputCapsule.startsWith(`${outputCapsule}.`)
}

export function outputEndpoints(schema: ComponentSchema): CapsuleEndpoint[] {
  return (schema.exports?.attributes ?? []).flatMap((attribute) => {
    const capsule = capsuleOf(attribute.type)
    if (!capsule) {
      return []
    }
    return [{ name: attribute.name, path: [attribute.name], capsule, multiple: false }]
  })
}

export function inputEndpoints(schema: ComponentSchema): CapsuleEndpoint[] {
  return collectInputEndpoints(schema.arguments)
}

export function capsuleOf(type: SchemaType): string | undefined {
  if (type.kind === 'capsule') {
    return type.capsule
  }
  if (type.kind === 'list' && type.elem.kind === 'capsule') {
    return type.elem.capsule
  }
  return undefined
}

function collectInputEndpoints(body: SchemaBody, basePath: string[] = []): CapsuleEndpoint[] {
  const endpoints: CapsuleEndpoint[] = []

  for (const attribute of body.attributes ?? []) {
    const capsule = capsuleOf(attribute.type)
    if (capsule) {
      endpoints.push({
        name: attribute.name,
        path: [...basePath, attribute.name],
        capsule,
        multiple: attribute.type.kind === 'list',
      })
    }
  }

  for (const block of body.blocks ?? []) {
    endpoints.push(...collectInputEndpoints(block.body, [...basePath, block.name, '0']))
  }

  return endpoints
}
