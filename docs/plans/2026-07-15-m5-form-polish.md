# M5: 優先ファミリーのフォーム作り込み

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)

## ゴール

prometheus.* / loki.* / otelcol.* / discovery.* の一般的なユースケースを、raw入力（River式のテキスト直書き）に頼らずフォームだけで組めるようにする。汎用フォーム自体の底上げを中心とし、コンポーネント個別のハードコードは最小限にする。

## 成果物

1. **enum blockのサポート**（最重要。loki.process の `stage` 等）
   - スキーマの `enum: true` のblockは「バリアントを1つ選ぶblock」: body内のblock群（例: stage.json / stage.regex / stage.labels…約30種）から種類を選んで追加するUIにする
   - IR上は選んだバリアントをネストblockとして保持（`stage` block > `json` block）。シリアライザ出力は `stage.json { ... }` 形式（Alloyのenum block構文）になること — **現行シリアライザの出力をv1.17.1のvalidateで必ず確認し、必要ならシリアライザを拡張**（goldenテスト追加）
   - multiple対応（stageは順序付き複数）: 追加・削除・並べ替え（上下ボタンで可）
2. **ウィジェット改善**
   - duration: テキスト入力＋形式ヒント（`30s`, `2m`）＋不正時のインラインエラー
   - secret / optional_secret: マスク表示と表示切替
   - number: `<input type="number">`
   - list(スカラー): 行単位の追加/削除UI（現テキストエリアからの置換え）
   - map: key/value行エディタの維持・改善（追加/削除）
   - raw: 「River式」と明示し、等幅フォント
3. **ドキュメントリンク**: 選択コンポーネントのパネルヘッダに公式リファレンスへのリンク（`https://grafana.com/docs/alloy/latest/reference/components/<第1セグメント>/<フルネーム>/`。例: prometheus.remote_write → `.../components/prometheus/prometheus.remote_write/`）
4. **バリデーション集約**: ツールバーに「issues」表示（全コンポーネントの必須未入力数）。クリックで該当コンポーネント選択
5. **ノード表示改善**: ノードに代表的な設定値のプレビュー1行（例: remote_writeのendpoint url、scrapeのjob_name。値が無ければ非表示）

## 受け入れ条件（各ファミリー1本、ブラウザE2Eで構築→export→公式v1.17.1バイナリでvalidate）

1. prometheus: discovery.kubernetes → prometheus.scrape → prometheus.remote_write（endpointにbasic_auth、scrape_interval設定）
2. loki: loki.source.api → loki.process（stage.json と stage.labels の2ステージ）→ loki.write
3. otelcol: otelcol.receiver.otlp（grpc）→ otelcol.processor.batch → otelcol.exporter.otlphttp（clientのendpoint設定）
4. discovery: discovery.kubernetes → discovery.relabel（rule 2本: keep + labelmap）→ prometheus.scrape → prometheus.remote_write
5. 上記すべてraw入力ウィジェットを使わずに構築できる
6. `npm run lint && npm run typecheck && npm test && npm run build` と golden がgreen（シリアライザ拡張時はgoldenフィクスチャ追加）

## 注意

- コンポーネント名でswitchする個別フォームは作らない（スキーマ駆動を貫く）。どうしても必要な差分は「ウィジェット選択のヒューリスティック」に留める
- 既存のIR形式・保存形式を壊さない（後方互換）
- `/tmp` は小さいtmpfs。一時データは `~/.cache/custom-alloy-builder/` 配下へ
