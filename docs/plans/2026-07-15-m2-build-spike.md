# M2: カスタムビルド spike（clone → all.go 書換 → Docker ビルド）

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)

## ゴール

選択したコンポーネントだけを含むカスタムAlloyバイナリ（linux/amd64）を、Alloyソースの `internal/component/all/all.go` を書き換えてDockerコンテナ内でビルドできることを証明する。API・UIはまだ作らない。ここで作るGoパッケージはM6のバックエンド（DockerExecutor）がそのまま再利用する。

## 成果物

1. `backend/internal/alloysrc/` — Alloyソース管理パッケージ
   - `Ensure(cacheRoot, version string) (dir string, err error)`: `<cacheRoot>/src/alloy-<version>` に `git clone --depth 1 --branch <version> https://github.com/grafana/alloy`（キャッシュ済みならスキップ）
   - `PrepareWorkspace(cloneDir, workDir string) error`: クローンをビルド用ワークスペースへコピー（`.git` 除外可。rsyncまたはGo実装）
   - `RewriteAll(workDir string, importPaths []string) error`: `internal/component/all/all.go` を、指定importPathのblank importのみ（ソート・重複除去）で上書き
   - ユニットテスト: `RewriteAll` が正しいall.goを生成すること（テンポラリディレクトリで検証、クローン不要）
2. `backend/internal/buildspec/` — ビルド要求の解決
   - `Resolve(schemasFS, version string, components []string) ([]string /* importPaths */, error)`: `schemas/<version>/index.json` からコンポーネント名→importPathを解決。未知のコンポーネント名はエラー
   - schemasは `go:embed` せず、まずリポジトリルートからの相対パス読み込みでよい（M6でembedを検討）
3. `backend/internal/executor/` — 実行戦略
   - `type Spec struct { Version, WorkDir string; GOOS, GOARCH string; OutputPath string; BuildImageTag string }`
   - `type Executor interface { Build(ctx context.Context, spec Spec, logs io.Writer) error }`
   - `DockerExecutor`: `docker run --rm -v <workDir>:/src -w /src grafana/alloy-build-image:<tag>` で `make alloy`（`GOOS/GOARCH/GOARCH` を環境変数で渡す）を実行し、`build/alloy` を `OutputPath` へコピー。イメージタグは `schemas/versions.json` の `buildImageTag` を使う
   - 注意: コンテナ内のnpm/goキャッシュはビルドごとに使い捨てでよい（最適化はM6）。コンテナ内でのパーミッション問題（root書き込み）に注意し、成果物をホストへ確実に取り出すこと
4. `backend/cmd/buildctl/` — spike用CLI
   - `buildctl -version v1.17.1 -components prometheus.scrape,prometheus.remote_write,loki.write,otelcol.receiver.otlp,discovery.kubernetes -o build/alloy-custom`
   - フロー: buildspec.Resolve → alloysrc.Ensure → PrepareWorkspace → RewriteAll → DockerExecutor.Build
   - `-strategy host` は今回未実装でよい（フラグだけ予約）
5. `.github/workflows/smoke-build.yml` — nightly（cron）＋ workflow_dispatch。上記最小サブセットで buildctl を実行し、成果物に対して受け入れ条件2・3の検証を行う

## 受け入れ条件

1. ローカルで buildctl が上記5コンポーネント構成のlinux/amd64バイナリを生成する
2. 生成バイナリが `--version` に応答する（このホストはlinuxなので直接実行可能）
3. 生成バイナリで
   - 含めたコンポーネントのみを使う設定（例: prometheus.scrape → prometheus.remote_write）の `validate` が通る
   - 除外したコンポーネント（例: `local.file`）を使う設定の `validate` が失敗する
4. `go vet ./...` / `go test ./...` が通る（既存CI green維持）
5. smoke-build.yml がworkflow_dispatchでgreen

## 既知の環境注意

- このホストの `/tmp` はtmpfs（小さい）。大きな一時ファイルは `~/.cache/custom-alloy-builder/` 配下を使う
- Docker 29.0.0 / buildx v0.29.1 が利用可能
- クローンキャッシュ `~/.cache/custom-alloy-builder/src/alloy-v1.17.1` はM1で作成済み
- コンテナイメージ出力（OCI tar / --load）はM7スコープ。今回はバイナリのみ
