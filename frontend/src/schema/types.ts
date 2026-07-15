export interface SchemaIndex {
  version: string
  components: SchemaIndexComponent[]
}

export interface SchemaIndexComponent {
  name: string
  stability: string
  community: boolean
  importPath: string
  inputs?: string[]
  outputs?: string[]
}

export interface ComponentSchema {
  name: string
  importPath: string
  stability: string
  community: boolean
  arguments: SchemaBody
  exports?: SchemaBody
}

export interface SchemaBody {
  attributes?: SchemaAttribute[]
  blocks?: SchemaBlock[]
}

export interface SchemaAttribute {
  name: string
  required: boolean
  default?: unknown
  type: SchemaType
}

export interface SchemaBlock {
  name: string
  required: boolean
  multiple?: boolean
  body: SchemaBody
}

export type SchemaType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'bool' }
  | { kind: 'duration' }
  | { kind: 'secret' }
  | { kind: 'optional_secret' }
  | { kind: 'enum'; values?: string[] }
  | { kind: 'map'; value?: SchemaType }
  | { kind: 'list'; elem: SchemaType }
  | { kind: 'object'; body?: SchemaBody }
  | { kind: 'capsule'; capsule: string; goType?: string }
  | { kind: 'raw'; goType?: string }

export interface CapsuleEndpoint {
  name: string
  path: string[]
  capsule: string
  multiple: boolean
}
