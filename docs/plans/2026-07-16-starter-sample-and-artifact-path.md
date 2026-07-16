# 初期サンプル設定とビルド成果物パスの表示

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)（v0.1タグ前の最終修正）

## 背景（ユーザーフィードバック 2026-07-16）

1. Config Builderで「どう接続するのか」が初見でわかりづらい。初期画面に小さな設定例が最初から置いてあるとよい
2. Binary Builderでビルドは成功するが、**生成されたバイナリの絶対パスがUIに出ない**ため、ターミナルでの起動テストができない

## 変更内容

### 1. Config Builder: スターターサンプル（`frontend/src/ConfigBuilder.tsx`, `frontend/src/graph/irGraph.ts`）

- キャンバスが空の状態でConfig Builderを開いたとき（初回マウント時のみ）、接続済みの小さなサンプルパイプラインを自動配置する:
  - `discovery.kubernetes "default"`（role="pod"）→ `prometheus.scrape "default"`（job_name="example"、targets/forward_toはref接続）→ `prometheus.remote_write "default"`（endpoint url="http://localhost:9009/api/v1/push"）
  - レイアウトは左→右に整列し、エッジ2本が最初から見えている状態
  - **このサンプルのExportがAlloy v1.17.1の `alloy validate` を通ること**
- 実装: サンプルIR＋レイアウトを返す純関数 `starterSample(registry)` 相当を `irGraph.ts`（またはサンプル専用モジュール）に置き、必要スキーマ（3コンポーネント）をロードしてから適用。Load（ファイル読込）した場合やユーザーが操作を始めた後に勝手に再出現しないこと
- ツールバーに「Clear」ボタンを追加（全ノード・エッジ・レイアウトを消して空キャンバスへ。確認ダイアログは `window.confirm` で可）
- パレットのヒント文言に「ハンドルをドラッグして接続」の一文を追加

### 2. Binary Builder: 成果物の絶対パス表示（backend + frontend）

- バックエンド（`backend/internal/jobs/`, `backend/internal/api/`）: ジョブ状態レスポンスの `artifacts[]` に `path`（ホスト上の絶対パス）を追加する。kind=binary と kind=oci（tar）はファイルの絶対パス、kind=image は従来どおりイメージタグ（pathは省略）
- フロントエンド（`frontend/src/builder/BinaryBuilder.tsx`, `frontend/src/api/client.ts`）: ビルド完了後の成果物リストに、ダウンロードリンクに加えて
  - 絶対パスを等幅フォントで表示＋「Copy path」ボタン（`navigator.clipboard`）
  - 起動テスト用のコマンド例を表示: `chmod +x <path> && <path> --version`（コピーボタン付き。kind=imageの場合は `docker run --rm <tag> --version`）
- APIのhttptestテストに `path` フィールドの検証を追加

## やらないこと

- 成果物の保存先変更（`~/.cache/custom-alloy-builder/artifacts/<jobID>/` のまま）
- サンプルのバリエーションやテンプレートギャラリー（将来課題）

## 受け入れ条件

1. フロントエンドゲート（lint/typecheck/test/build/golden）と backend `go vet ./... && go test ./...` green
2. Playwright E2E: 素のdevサーバーでConfig Builderを開くと3ノード・2エッジのサンプルが表示され、そのままのExportが `~/.cache/custom-alloy-builder/bin/alloy` の validate を通る。Clearで空になり、リロードすると再びサンプルが出る
3. 実ビルド（docker戦略・ウォームキャッシュ）1回: 完了後のUI（またはAPIレスポンス）に成果物の絶対パスが表示され、**そのパスのファイルを直接 `--version` 実行できる**
4. 既存goldenテスト・CIがgreenのまま

## 注意

- devサーバー起動前に残骸のviteプロセスを必ず掃除（前回4本残留していた）。E2Eは自分で起動したサーバーの実ポートに向けること
- `/tmp` は小さいtmpfs
