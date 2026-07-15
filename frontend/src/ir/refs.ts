import type { IRBody, IRConfig, IRValue } from "./types"

export interface IRRef {
  from: string
  target: string
}

export function collectRefs(config: IRConfig): IRRef[] {
  const refs: IRRef[] = []

  for (const component of config.components) {
    collectBodyRefs(component.id, component.body, refs)
  }

  return refs
}

function collectBodyRefs(from: string, body: IRBody, refs: IRRef[]): void {
  for (const value of Object.values(body.attrs)) {
    collectValueRefs(from, value, refs)
  }

  for (const block of body.blocks) {
    collectBodyRefs(from, block.body, refs)
  }
}

function collectValueRefs(from: string, value: IRValue, refs: IRRef[]): void {
  switch (value.t) {
    case "ref":
      refs.push({ from, target: value.target })
      return
    case "list":
      for (const item of value.v) {
        collectValueRefs(from, item, refs)
      }
      return
    case "map":
      for (const item of Object.values(value.v)) {
        collectValueRefs(from, item, refs)
      }
      return
    case "string":
    case "number":
    case "bool":
    case "raw":
      return
  }
}
