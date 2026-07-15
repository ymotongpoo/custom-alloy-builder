import type { IRConfig } from "../ir/types"

export interface Importer {
  parse(text: string): IRConfig
}
