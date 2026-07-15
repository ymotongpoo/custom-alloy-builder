# M4: 設定ビルダーUI（汎用版）

親プラン: [2026-07-15-v0.1-implementation.md](2026-07-15-v0.1-implementation.md)

## ゴール

ブラウザだけで「コンポーネントをキャンバスに置く→フォームで引数を編集→接続する→River設定をエクスポート」が完結するUIを作る。GitHub Pages（静的サイト）で動作すること。フォームの見た目の作り込みはM5で行うので、ここでは**全コンポーネントがスキーマ駆動の汎用フォームで一応編集できる**状態を目指す。

## アーキテクチャ原則（厳守）

- **IR（`frontend/src/ir/types.ts`）が唯一の真実**。React Flowのノード/エッジはIR＋レイアウトから導出する。UI状態をIRに混ぜない
- エッジはIR中の `ref` 値から導出（`collectRefs` を利用・拡張してよい）。エッジ作成＝対象属性への `ref` 書き込み、エッジ削除＝`ref` 除去
- シリアライザ（M3）はそのまま使う。変更が必要なら最小限にし、goldenテストを維持する

## 成果物

1. **スキーマ配信**: `schemas/` をビルド時に `frontend/public/schemas/` へコピーする仕組み（npmスクリプトの prebuild/predev コピーで可。シンボリックリンクは不可＝WindowsとCIの互換性）。`.gitignore` に `frontend/public/schemas/` を追加
2. `frontend/src/schema/` — スキーマTS型（ジェネレータのJSON形式に対応）、ローダ（`index.json` は起動時、コンポーネント個別スキーマはノード追加時に遅延fetch、メモリキャッシュ）、capsule互換判定 `canConnect(outputCapsule, inputCapsule): boolean`（v0.1は完全一致）
3. `frontend/src/graph/` — React Flow（@xyflow/react）キャンバス
   - パレット: `index.json` のコンポーネント一覧（名前でインクリメンタル検索、stabilityバッジ表示）。クリックまたはドラッグでキャンバスに追加。追加時にラベルを自動採番（`default`, `default_2`…）
   - ノード: コンポーネント名＋ラベル表示。exports側（outputs）のcapsuleごとにsource handle、arguments側（inputs）のcapsule型属性ごとにtarget handleを出す。handleにcapsule IDをツールチップ表示
   - 接続: `isValidConnection` でcapsule一致のみ許可。接続確定時、対象属性が `list` of capsule なら既存リストに `ref` を追加、単一capsuleなら置換。エッジ削除で逆操作
   - ノード削除: IRからコンポーネント除去＋他コンポーネントからの参照refも除去（dangling ref防止）
   - レイアウト: ノード座標は `layout: Record<componentId, {x, y}>` としてIRの外で管理
4. `frontend/src/forms/` — スキーマ駆動の汎用フォーム（選択ノードのサイドパネル）
   - kind別ウィジェット: string/duration→テキスト、number→数値、bool→チェックボックス、secret/optional_secret→パスワード入力、enum→（スキーマにenumが無い場合はテキスト）、list(string等スカラー)→1行1要素のテキストエリア、map→key=value行エディタ、capsule→読み取り専用（接続で管理する旨を表示）、raw→「River式」ラベル付きテキストエリア
   - block: 折りたたみセクション。`multiple: true` は「＋追加/削除」でインスタンス管理。required blockは初期表示
   - 必須属性は未入力時にバリデーション表示（送信の概念はないので枠色＋メッセージ程度）
   - 値が未設定の任意属性はIRに書き込まない（デフォルト値をエクスポートに混ぜない）
5. **エクスポート**: ツールバーの「Export」で `serialize(ir)` の結果をモーダル表示（コピー・`config.alloy` ダウンロード）
6. **保存/読込**: 「Save」= `{formatVersion: 1, ir, layout}` をJSONダウンロード、「Load」=ファイル選択で復元（formatVersion検証）
7. **Config Builderタブへの組み込み**: 既存のタブUIの Config Builder タブに搭載。Binary Builderタブはプレースホルダのまま
8. ユニットテスト（vitest）: IR⇄グラフ導出ロジック（エッジ導出・接続時のref書き込み・ノード削除時のref除去）、スキーマローダ、フォームの値変換（最低限）
9. Pages対応: fetchパスは `import.meta.env.BASE_URL` 起点（`/custom-alloy-builder/` 配下で動くこと）

## 受け入れ条件

1. `npm run lint && npm run typecheck && npm test && npm run build` すべて成功
2. `npm run dev` で起動し、以下がブラウザで完結する:
   - パレットから discovery.kubernetes / prometheus.scrape / prometheus.remote_write を追加
   - scrapeのフォームで `job_name` を設定、remote_writeの endpoint block を追加して `url` を設定
   - kubernetes→scrape（targets）、scrape→remote_write（forward_to）を接続
   - Exportした設定テキストが公式Alloy v1.17.1バイナリ（`~/.cache/custom-alloy-builder/bin/alloy`）の `validate` を通る
   - Save→リロード→Load でグラフとフォーム内容が復元される
3. 接続の型チェック: prometheus系outputをloki系inputに繋ごうとすると拒否される
4. 既存のgolden/CIテストがすべてgreenのまま

## 注意

- 見た目はプレーンなCSSで整っていれば十分（M5で磨く）。ダークテーマ不要
- `/tmp` は小さいtmpfs。大きな一時データは `~/.cache/custom-alloy-builder/` 配下へ
- 検証にはPlaywright等ブラウザ自動化を使ってよい（devサーバーで）
