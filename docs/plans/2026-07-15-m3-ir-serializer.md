# M3: IR＋Riverシリアライザ＋goldenテスト

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)

## ゴール

UIから独立した純粋データの中間表現（IR）と、IR→River設定テキストのシリアライザをTypeScriptで実装し、生成結果が実Alloyバイナリの `alloy validate` を通ることをCIで常時保証する。

## 成果物

1. `frontend/src/ir/types.ts` — IR型定義（親プランの定義に準拠）

   ```ts
   export type IRValue =
     | { t: "string"; v: string }
     | { t: "number"; v: number }
     | { t: "bool"; v: boolean }
     | { t: "list"; v: IRValue[] }
     | { t: "map"; v: Record<string, IRValue> }   // object/map両方を表現
     | { t: "ref"; target: string }               // 例: "prometheus.remote_write.default.receiver"
     | { t: "raw"; v: string };                   // River式をそのまま埋め込むエスケープハッチ

   export interface IRBody { attrs: Record<string, IRValue>; blocks: IRBlockInstance[] }
   export interface IRBlockInstance { name: string; label?: string; body: IRBody }
   export interface IRComponent { id: string; type: string; label: string; body: IRBody }
   export interface IRConfig {
     formatVersion: 1;
     alloyVersion: string;
     components: IRComponent[];
     rawSnippets: string[];       // グラフで表現できない設定ブロックを丸ごと保持
   }
   ```

2. `frontend/src/ir/refs.ts` — `collectRefs(config): {from: componentId, target: string}[]`（IR中の `ref` 値を走査。将来React Flowのエッジ導出に使う）
3. `frontend/src/river/serialize.ts` — `serialize(config: IRConfig): string`
   - コンポーネント: `<type> "<label>" { ... }`（typeにlabel不要なものは考慮不要。v0.1は常にlabel付き）
   - 属性: `name = <value>`、値のエンコード: string→ダブルクォートJSONエスケープ、number/bool→リテラル、list→`[a, b]`、map→`{"key" = value, ...}`（キーはクォート）、ref→ターゲットをそのまま識別子として出力、raw→そのまま出力
   - ネストblock: `name { ... }` / ラベル付きblock: `name "label" { ... }`。blockは定義順を保持
   - インデントはタブ（`alloy fmt` の慣習に合わせる）、コンポーネント間は空行1つ、`rawSnippets` は末尾にそのまま連結
   - 決定性: 同一IR→バイト同一出力。attrsはIRの挿入順（JSONパース順）を保持
   - alloy-configurator（Apache-2.0）の `src/lib/river.ts` を参考にした場合はNOTICEに追記不要（既に記載済み）だが、ファイル先頭コメントに出典を書く
4. `frontend/src/river/importer.ts` — `export interface Importer { parse(text: string): IRConfig }` 型定義のみ（実装なし。B案の受け皿）
5. `frontend/src/ir/serialize.test.ts` 等のユニットテスト（vitest）: 値エンコード各種・ネストblock・ref・raw・決定性
6. `testdata/golden/` — フィクスチャ5つ以上。各 `<name>.ir.json` と期待出力 `<name>.alloy` のペア:
   - `prometheus-scrape-remote-write`: discovery.kubernetes → prometheus.scrape → prometheus.remote_write（basic_authネスト含む）
   - `loki-pipeline`: loki.source.file相当は使わず（file_matchはOK）、シンプルに loki.process → loki.write（processのstage blockはmultiple）
   - `otelcol-pipeline`: otelcol.receiver.otlp → otelcol.processor.batch → otelcol.exporter.otlp（output blockのconsumerリストref）
   - `discovery-relabel`: discovery.kubernetes → discovery.relabel（rule block、ラベル付きでなくてよい）
   - `raw-escape-hatch`: 通常コンポーネント＋`raw` 値属性＋`rawSnippets`（例: `logging` ブロック）を含む
   - **フィクスチャの設定内容はAlloy v1.17.1で実際にvalidateが通る現実的なもの**にする（schemas/v1.17.1/components/ の該当スキーマを参照して属性名・型を正確に）
7. `frontend/scripts/golden.ts`（または `npm run golden -- <ir.json>` で1ファイル出力できるCLI）: ir.jsonを読んでserializeし標準出力へ。CIとローカル検証で使う
8. `.github/workflows/ci.yml` に goldenジョブを追加:
   - `npm run golden` で全フィクスチャをシリアライズし、コミット済み `.alloy` とdiff（不一致で失敗）
   - Alloy v1.17.1 公式リリースバイナリ（github releasesの `alloy-linux-amd64.zip`）をダウンロード・キャッシュし、各 `.alloy` に `alloy validate` を実行
   - 注意: validateはコンポーネント定義を要求するため**公式フルバイナリ**を使う（カスタムビルド不要）

## 受け入れ条件

1. vitestユニットテストが通る（値エンコード・ネスト・決定性）
2. 全フィクスチャで `serialize(ir) == 期待.alloy`（バイト一致）
3. 全フィクスチャの `.alloy` が公式Alloy v1.17.1バイナリの `validate` を通る（ローカルで実証すること。バイナリは `~/.cache/custom-alloy-builder/bin/` にダウンロードしてよい）
4. `npm run lint && npm run typecheck && npm test && npm run build` すべて成功
5. ci.ymlのgoldenジョブ定義がローカル検証と同じ手順を踏んでいる

## 注意

- `/tmp` は小さいtmpfs。大きな一時ファイルは `~/.cache/custom-alloy-builder/` 配下へ
- IRはReact Flowから独立させること（このマイルストーンではUIコードに一切触れない）
- `logging` や `declare` などコンポーネント以外のblockはIRでは `rawSnippets` 扱い（v0.1の割り切り）
