# M6: バイナリビルダー E2E（バックエンドAPI＋UI統合）

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)

## ゴール

ローカルで起動した単一プロセス（Goバックエンド＋embedフロントエンド）のWeb UIから、コンポーネントを選択してカスタムAlloyバイナリをビルドし、ダウンロードできるようにする。

## 成果物

### バックエンド

1. `backend/internal/api/` 拡張 — REST API（親プラン準拠）:
   - `GET /api/v1/versions` — `schemas/versions.json` の内容
   - `GET /api/v1/versions/{v}/components` — `schemas/{v}/index.json` パススルー
   - `POST /api/v1/builds` — `{version, components[], targets[{os,arch}], output: "binary", strategy: "docker"|"host"}` → `{id}`。バリデーション: バージョン存在・コンポーネント名解決（buildspec.Resolve）・戦略とターゲットの整合（docker→linuxのみ）
   - `GET /api/v1/builds/{id}` — `{id, status, error?, artifacts: [{name, size}]}`。status: `queued|cloning|generating|building|done|error`
   - `GET /api/v1/builds/{id}/logs` — SSE（`text/event-stream`）。ビルドログを逐次配信、完了時に `event: done` を送る。途中参加時は既存ログ全量を先に流す
   - `GET /api/v1/builds/{id}/artifacts/{name}` — 成果物ダウンロード
2. `backend/internal/jobs/` — 直列実行のインメモリジョブキュー
   - ジョブ実行フロー: buildspec.Resolve → alloysrc.Ensure（status: cloning）→ PrepareWorkspace＋RewriteAll（generating）→ executor.Build（building、ターゲットごとに逐次）→ done/error
   - ログはメモリ上のリングバッファ＋購読者へのブロードキャスト（`io.Writer` 実装で executor へ渡す）
   - 成果物は `~/.cache/custom-alloy-builder/artifacts/<jobID>/` に配置
3. スキーマの解決: 実行時にディスクから読む。`-schema-root` フラグ（デフォルトは実行ファイル位置と カレントディレクトリから `schemas/` を探索）。**embedはM7で検討**（このマイルストーンではやらない）
4. 既存 `cmd/custom-alloy-builder` にAPIを配線（フロントembed配信は既存のまま）。`cmd/buildctl` は残す

### フロントエンド

5. `frontend/src/builder/` — Binary Builderタブの実装
   - 起動時に `GET /api/v1/versions` で能力プローブ。失敗時（=GitHub Pages等）は「ローカル実行が必要」の案内（`go run` / バイナリ実行手順）を表示
   - バージョン選択 → コンポーネント選択UI（検索付きチェックリスト、ファミリー（名前の第1セグメント）でグループ化、選択数表示）
   - ターゲット選択: strategy docker → linux/amd64, linux/arm64 のチェックボックス。strategy host → 「このマシン向け」1択
   - Buildボタン → ジョブ作成 → ステータス表示＋SSEログのライブ表示（自動スクロール）→ 完了後に成果物ダウンロードリンク
   - **設定ビルダーとの連携**: Config Builderで使用中のコンポーネント一覧を「現在の設定から選択」ボタンで反映できる
6. APIクライアント: `frontend/src/api/`（`import.meta.env.BASE_URL` とは独立に、同一オリジンの `/api/v1` を叩く）

## 受け入れ条件

1. `cd backend && go vet ./... && go test ./...`（APIハンドラのhttptestテスト: versions/components/builds作成のバリデーション、fake executorでのジョブ遷移、SSE配信）、フロントエンドゲート（lint/typecheck/test/build/golden）すべてgreen
2. E2E（実ビルド1回、Playwright＋実Docker）:
   - `make frontend-build && make backend-build` → `./backend/bin/custom-alloy-builder` 起動
   - ブラウザでBinary Builderタブ→ v1.17.1 選択 → prometheus.scrape, prometheus.remote_write, loki.write, otelcol.receiver.otlp, discovery.kubernetes を選択 → docker戦略 linux/amd64 → Build
   - SSEログがUIに流れる（Playwrightでログ要素の増加を確認）
   - 完了後、成果物をダウンロードし `--version` 応答・included設定のvalidate成功・`local.file` 設定のvalidate失敗を確認
3. Pages相当（バックエンドなしの `npm run dev` またはPages本番）でBinary Builderタブが案内表示になる
4. ビルド中にもConfig Builderタブの操作がブロックされない（SPAとして自然に動く）

## 注意

- 認証なし・localhostバインド（`-addr` デフォルト `127.0.0.1:8085`）。ローカルツールとしての割り切りを README に記載（M7）
- ジョブ・ログは永続化しない（プロセス再起動で消える）
- `/tmp` は小さいtmpfs。ワークスペース・成果物は `~/.cache/custom-alloy-builder/` 配下
- Dockerビルドは1回15分程度かかる。E2Eではタイムアウトを十分に取る
