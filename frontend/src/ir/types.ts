export type IRValue =
  | { t: "string"; v: string }
  | { t: "number"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "list"; v: IRValue[] }
  | { t: "map"; v: Record<string, IRValue> }
  | { t: "ref"; target: string }
  | { t: "raw"; v: string }

export interface IRBody {
  attrs: Record<string, IRValue>
  blocks: IRBlockInstance[]
}

export interface IRBlockInstance {
  name: string
  label?: string
  body: IRBody
}

export interface IRComponent {
  id: string
  type: string
  label: string
  body: IRBody
}

export interface IRConfig {
  formatVersion: 1
  alloyVersion: string
  components: IRComponent[]
  rawSnippets: string[]
}
