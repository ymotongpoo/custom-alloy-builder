# 2026-07-15: v0.1 要件確定（インタビュー記録）

## 目的

必要なコンポーネントだけを含むカスタムGrafana Alloyバイナリのビルドと、グラフィカルなパイプライン編集によるRiver設定生成を、単一のWeb UIで提供する。設定ビルダー部分はGitHub Pages単体でも動作させる。

## やること

1. スキーマジェネレータ（Go）: Alloyソース（`internal/component/` 配下のArguments/Exports構造体）をリフレクションで走査し、コンポーネントのJSONスキーマを生成。対象はAlloy v1.17.1 / v1.16.3 / v1.15.1 の3バージョンで、事前生成してリポジトリにコミット
2. 設定ビルダー（React + TypeScript + Vite + React Flow）: コンポーネントをキャンバスに配置・接続してRiver設定をエクスポート。UIとRiver構文の間に独立した中間表現（IR）レイヤーを設け、将来のインポート（River→IR）対応と未対応構文の生テキスト保持を可能にする設計。グラフ状態のJSON保存・再読込に対応。GitHub Pagesへデプロイ
3. バイナリビルダー（Goローカルバックエンド）: フロントエンドをembedした単一バイナリ。選択バージョンのAlloyソースを取得し `internal/component/all/all.go` を選択コンポーネントのみに書き換えてビルド。実行戦略は2系統 — Docker実行（Linux amd64/arm64バイナリ＋コンテナイメージ出力）とホストネイティブ実行（macOS上でdarwinバイナリ。Windowsも経路は塞がないが未保証・イメージ出力なし）
4. CI（GitHub Actions）: シリアライザが生成したRiver設定を実Alloyバイナリの `alloy validate` に通すゴールデンテストを含む
5. リポジトリ: `ymotongpoo/custom-alloy-builder`（public、最初から。公開範囲はユーザー確認済み）

## やらないこと

- ホスト型サービス化（マルチユーザー、認証、サーバーサイドビルドの公開提供）
- River設定のインポート機能 — IRで受け皿だけ用意し将来課題
- プロダクト機能としての `alloy validate` 連携（CIテスト専用）
- 全コンポーネントのUI動作保証（作り込みは prometheus.* / loki.* / otelcol.* / discovery.* を優先、他はベストエフォート）
- Windowsの動作保証・CI検証・コンテナイメージ出力

## 完了条件（v0.1）

- 3バージョン分のJSONスキーマが生成・コミット済み
- GitHub Pages上の設定ビルダーで、配置→引数編集→接続→妥当なRiver設定のエクスポートとグラフの保存・再読込ができる
- ローカル起動したツールから、Docker経由でLinux amd64/arm64バイナリ＋コンテナイメージ、macOSネイティブ実行でdarwinバイナリを取得でき、ビルドされたカスタムバイナリが選択コンポーネントを含む設定で動作する
- `alloy validate` ゴールデンテストを含むCIがGitHub Actionsで回っている

## 主要な設計判断の根拠

- **ソースツリー書き換え方式**: Alloyのコンポーネント登録は `internal/component/all/all.go`（blank importリスト）にあり `internal/` のため外部モジュールからimport不可。ocb方式（外部合成）は使えない
- **リフレクション方式のスキーマ生成**: 純粋なAST解析はパッケージ横断の型解決が必要で脆い。ジェネレータをクローン内に置けば同一モジュールとして `internal/` にアクセスでき、レジストリをリフレクションで走査できる
- **macOSはホストネイティブビルド**: 公式ビルドイメージ `grafana/alloy-build-image` はLinuxマルチアーチのみでdarwinクロスコンパイル非対応
- **シリアライザは alloy-configurator（Apache-2.0）の river.ts を翻案**: attribution必須

## 実装体制

細かな実装は Codex CLI / Cursor CLI に委譲し、Claude Code（Fable 5）が計画・タスク仕様作成・検証を担う。エージェント間の引き渡しは agmsg（https://github.com/fujibee/agmsg）を使用。

## 参考

- 実装計画: [docs/plans/2026-07-15-v0.1-implementation.md](../plans/2026-07-15-v0.1-implementation.md)
- 既存の類似ツール: https://github.com/grafana/alloy-configurator
