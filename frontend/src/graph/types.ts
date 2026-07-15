import type { IRConfig } from '../ir/types'

export interface LayoutPoint {
  x: number
  y: number
}

export type LayoutMap = Record<string, LayoutPoint>

export interface BuilderDocument {
  formatVersion: 1
  ir: IRConfig
  layout: LayoutMap
}

export interface SchemaRegistryEntry {
  outputs: Record<string, string>
  inputs: Record<string, { capsule: string; path: string[]; multiple: boolean }>
}

export type SchemaRegistry = Record<string, SchemaRegistryEntry>
