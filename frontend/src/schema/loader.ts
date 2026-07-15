import type { ComponentSchema, SchemaIndex } from './types'

const componentCache = new Map<string, Promise<ComponentSchema>>()

export async function loadSchemaIndex(version = 'v1.17.1'): Promise<SchemaIndex> {
  const response = await fetch(schemaUrl(version, 'index.json'))
  if (!response.ok) {
    throw new Error(`Failed to load schema index: ${response.status}`)
  }
  return (await response.json()) as SchemaIndex
}

export async function loadComponentSchema(
  name: string,
  version = 'v1.17.1',
): Promise<ComponentSchema> {
  const key = `${version}/${name}`
  const cached = componentCache.get(key)
  if (cached) {
    return cached
  }

  const pending = fetch(schemaUrl(version, `components/${name}.json`)).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${name} schema: ${response.status}`)
    }
    return (await response.json()) as ComponentSchema
  })
  componentCache.set(key, pending)
  return pending
}

export function clearSchemaCacheForTests(): void {
  componentCache.clear()
}

function schemaUrl(version: string, path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${base}schemas/${version}/${path}`
}
