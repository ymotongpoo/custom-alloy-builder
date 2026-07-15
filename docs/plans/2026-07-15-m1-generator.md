# M1: スキーマジェネレータ spike ＋ v1.17.1 スキーマ生成

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)

## ゴール

`grafana/alloy` v1.17.1 のソースから全コンポーネントのJSONスキーマを生成し、`schemas/v1.17.1/` にコミットする。生成は決定的（同一入力→バイト同一出力）であること。

## 成果物

- `generator/` — `package main` のGoソース群（このリポジトリではビルドしない。Alloyクローン内 `schemagen/` にコピーされ同一モジュール内で `go run ./schemagen` される前提。`go:build` タグ等は不要だが、alloyのgo.mod（go 1.26.4）でコンパイルできること）
- `generator/run-generator.sh` — 引数 `<version>`（例 `v1.17.1`）。動作:
  1. `~/.cache/custom-alloy-builder/src/alloy-<version>` に `git clone --depth 1 --branch <version> https://github.com/grafana/alloy` （キャッシュ済みならスキップ）
  2. `generator/*.go` をクローン内 `schemagen/` にコピー
  3. クローン内で `go run ./schemagen -out <repo>/schemas/<version>/`
  4. `schemas/versions.json` に該当バージョンのエントリを追記/更新（goVersionはクローンのgo.modから読む。buildImageTagはクローンのDockerfileの `grafana/alloy-build-image:` タグから読む）
- `schemas/v1.17.1/index.json` と `schemas/v1.17.1/components/<name>.json`（約190ファイル）

## ジェネレータの仕様

- `internal/component/all` をblank importして全コンポーネントのRegisterを発火させ、レジストリ（`internal/component/registry.go`）を走査する。イテレーションAPIが非公開の場合はリフレクションまたは同パッケージアクセサで取得（クローン内なので `internal/` にアクセス可能）
- 各 `component.Registration` から:
  - `name`, `stability`（`featuregate.Stability` → "experimental" | "public-preview" | "generally-available" | "undefined"）, `community`
  - `importPath`: `runtime.FuncForPC(reflect.ValueOf(reg.Build).Pointer()).Name()` から導出（1パッケージ複数コンポーネント対応のためall.goのパースでは不可）
  - `arguments` / `exports`: `reflect.TypeOf(reg.Args / reg.Exports)` を `alloy:"name,attr|block|label|enum[,optional]"` タグ駆動で再帰走査
- 型マッピング（判別共用体 `kind`）:
  - `string`→string、int/uint/float系→number、bool→bool
  - `time.Duration`→duration、`alloytypes.Secret`→secret、`alloytypes.OptionalSecret`→optional_secret
  - map→`{kind:map, value:<type>}`、slice→`{kind:list, elem:<type>}`（block タグ付き構造体のsliceは `multiple:true` のblock）
  - ネストしたblockタグ付き構造体→`{kind:block}` として再帰。**循環はvisited setで検出し `raw` で打ち切り**
  - capsuleエイリアス表に載る型（最低限: `storage.Appendable`→`prometheus.Appendable`、`loki.LogsReceiver`、`otelcol.Consumer`→traces/metrics/logs分割、`[]discovery.Target`→`discovery.Targets`）→`{kind:capsule, capsule:<id>, goType:<Go型文字列>}`
  - その他インターフェース・関数・未知型→`{kind:raw, goType:<Go型文字列>}`
- デフォルト値: Argsが `syntax.Defaulter`（`SetToDefault()`）実装ならゼロ値に適用し、スカラー属性のデフォルトを記録
- **1フィールドの解析失敗で全体を落とさない**: recoverして該当フィールドを `raw` にフォールバックし、stderrに警告
- 出力の決定性: コンポーネントはname順、フィールドは構造体定義順、JSONはインデント2・末尾改行・キー順固定（構造体マーシャル）

## スキーマ形式（例）

```json
{
  "name": "prometheus.remote_write",
  "importPath": "github.com/grafana/alloy/internal/component/prometheus/remotewrite",
  "stability": "generally-available",
  "community": false,
  "arguments": {
    "attributes": [
      {"name": "external_labels", "required": false,
       "type": {"kind": "map", "value": {"kind": "string"}}}
    ],
    "blocks": [
      {"name": "endpoint", "required": false, "multiple": true,
       "body": {"attributes": [
         {"name": "url", "required": true, "type": {"kind": "string"}},
         {"name": "remote_timeout", "required": false, "default": "30s",
          "type": {"kind": "duration"}}
       ], "blocks": ["...再帰..."]}}
    ]
  },
  "exports": {
    "attributes": [
      {"name": "receiver",
       "type": {"kind": "capsule", "capsule": "prometheus.Appendable", "goType": "storage.Appendable"}}
    ]
  }
}
```

`index.json` は `{version, components: [{name, stability, community, importPath, inputs: [capsuleId], outputs: [capsuleId]}]}`。inputs は arguments 内（トップレベル属性直下まででよい）の capsule 型、outputs は exports 内の capsule 型。

## 受け入れ条件

1. `./generator/run-generator.sh v1.17.1` が成功し `schemas/v1.17.1/` が生成される
2. 再実行して `git diff --exit-code schemas/` が通る（決定性）
3. `index.json` のコンポーネント数が180以上
4. `prometheus.remote_write` に endpoint block（url必須・basic_auth等のネスト）と exports.receiver capsule が含まれる
5. `otelcol.receiver.otlp` に grpc/http block と output block の consumer capsule が含まれる
6. `local.file` の attributes が filename(required string) / detector / poll_frequency(duration) / is_secret(bool)、exports.content が optional_secret である
