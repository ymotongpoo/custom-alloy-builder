import type { IRValue } from '../ir/types'
import type { SchemaType } from '../schema/types'

export function valueToInput(value: IRValue | undefined, type: SchemaType): string {
  if (!value) {
    return ''
  }
  if (value.t === 'string' || value.t === 'raw') {
    return value.v
  }
  if (value.t === 'number') {
    return String(value.v)
  }
  if (value.t === 'bool') {
    return value.v ? 'true' : 'false'
  }
  if (value.t === 'list') {
    return value.v.map((item) => valueToInput(item, scalarListType(type))).join('\n')
  }
  if (value.t === 'map') {
    return Object.entries(value.v)
      .map(([key, item]) => `${key}=${valueToInput(item, mapValueType(type))}`)
      .join('\n')
  }
  return value.target
}

export function inputToValue(input: string, type: SchemaType): IRValue | undefined {
  if (input.trim() === '') {
    return undefined
  }
  switch (type.kind) {
    case 'string':
    case 'duration':
    case 'secret':
    case 'optional_secret':
    case 'enum':
      return { t: 'string', v: input }
    case 'number': {
      const parsed = Number(input)
      return Number.isFinite(parsed) ? { t: 'number', v: parsed } : undefined
    }
    case 'bool':
      return { t: 'bool', v: input === 'true' }
    case 'raw':
      return { t: 'raw', v: input }
    case 'list':
      return {
        t: 'list',
        v: input
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => inputToValue(line, type.elem))
          .filter((value): value is IRValue => Boolean(value)),
      }
    case 'map': {
      const entries = input
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf('=')
          if (separator < 0) {
            return undefined
          }
          const key = line.slice(0, separator).trim()
          const rawValue = line.slice(separator + 1).trim()
          const value = inputToValue(rawValue, type.value ?? { kind: 'string' })
          return key && value ? ([key, value] as const) : undefined
        })
        .filter((entry): entry is readonly [string, IRValue] => Boolean(entry))
      return entries.length > 0 ? { t: 'map', v: Object.fromEntries(entries) } : undefined
    }
    case 'capsule':
    case 'object':
      return undefined
  }
}

function scalarListType(type: SchemaType): SchemaType {
  return type.kind === 'list' ? type.elem : { kind: 'string' }
}

function mapValueType(type: SchemaType): SchemaType {
  return type.kind === 'map' && type.value ? type.value : { kind: 'string' }
}
