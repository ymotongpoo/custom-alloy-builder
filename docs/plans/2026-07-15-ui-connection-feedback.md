# Config Builder: ドラッグ接続の実用化と不正接続フィードバック

## Context

ユーザーフィードバック（2026-07-15）:

1. Config Builderでコンポーネント同士をキャンバス上の線のドラッグで接続したい。型（capsule）互換のペアだけ接続でき、不正な接続を試みたら問題があることが視覚的にわかるようにしたい
2. Binary Builderの「Alloy / *」セクションの確認 → **調査で解決済み・変更不要**。全181コンポーネントが選択・ビルド可能（全エントリにimportPathがあり、`buildspec.Resolve()` は未知名以外拒否しない）。UIは現状維持

調査結果（1について）: ドラッグ接続は `onConnect`/`isValidConnection` が配線済みで技術的には動くが、UXが壊滅的。
- ハンドルは10pxの無装飾ドット（`App.css` の `.node-handle` はサイズ指定のみ）で、ラベル付きin/outボタン（クリック接続用）と離れた位置に絶対配置され、ドラッグ起点だと気づけない
- 不正接続はReact Flowが**無言で破棄**。valid/invalid状態のCSSは アプリにもライブラリ既定にも無く、`connectionLineComponent` も未使用
- `toFlowNodes`（`frontend/src/graph/irGraph.ts:52-64`）がノードを230x130に固定しており、入出力が3個以上だとハンドル（`top: 44 + index*24`）が枠外にはみ出す
- インストール済み `@xyflow/react` 12.11.2 は `ConnectionLineComponentProps.connectionStatus: 'valid' | 'invalid' | null`、`useConnection`、`onConnectStart/End`、`connectionRadius`、ハンドルの `valid`/`connectingfrom`/`connectionindicator` 状態クラスをサポート

## 実装体制

これまでのマイルストーン同様、実装はCodex CLI（codex:rescue経由）に委譲し、Claude Codeがタスク仕様の作成と検証（Playwright E2E含む）を行う。本プランがそのタスク仕様の元になる。仕様は `docs/plans/2026-07-15-ui-connection-feedback.md` としてコミットしてから委譲する。

## 変更内容

### 1. ハンドルとendpoint行の統合（`frontend/src/graph/BuilderNode.tsx`, `frontend/src/App.css`, `frontend/src/graph/irGraph.ts`）

- ノード内の各in/out行（現在の `endpoint-button` 行）に `<Handle>` を**行内に隣接配置**する（行を `position: relative` にし、Handleを行の左端/右端に縦中央で配置）。絶対座標 `top: 44 + index*24` のハンドル群は廃止
- `toFlowNodes` の固定 `height: 130`（および `measured`）をやめ、ノード高さをコンテンツに任せる（React Flow 12は実測ベースで動く。幅230は維持可）
- ハンドルの視認性向上: 14px、役割別の色（source/target）、ホバーで拡大＋`cursor: crosshair`。`connectionindicator` 状態のスタイルも定義
- クリック接続（out→inボタン）は既存のまま残す（両経路とも `addConnectionRef` に収束しており互換）

### 2. 接続中のリアルタイム型フィードバック（`frontend/src/ConfigBuilder.tsx`, 新規 `frontend/src/graph/ConnectionLine.tsx`, `App.css`）

- `connectionLineComponent` を実装: `connectionStatus` が `valid` なら緑・`invalid` なら赤の接続線を描画
- ハンドル状態CSS: ドラッグ中、接続可能なターゲットハンドル（`.react-flow__handle.valid` / `connectingto`）を緑ハイライト。互換のないハンドルは減光
- `connectionRadius={24}` を設定し、小さいハンドルでも吸着しやすくする

### 3. 不正接続時の説明メッセージ（`frontend/src/ConfigBuilder.tsx`, `frontend/src/graph/irGraph.ts`）

- `onConnectEnd(event, connectionState)` で、ドロップが不成立かつ from/to ハンドルが特定できる場合に理由メッセージを組み立てて表示: 例「`prometheus.remote_write` の出力 `receiver`（prometheus.Appendable）は `loki.process` の入力 `forward_to`（loki.LogsReceiver）には接続できません」
- メッセージはキャンバス上部の消えるバナー（4秒程度で自動消滅、×で即時消去）。`role="alert"`
- 理由組み立てヘルパーは `irGraph.ts` に純関数で追加（capsule IDの取り出しは既存の `parseSourceHandle`/`parseTargetHandle`/registry参照を再利用）し、ユニットテストを書く

### 4. 変更しないこと

- Binary BuilderのセクションUI（調査により全コンポーネントがビルド可能と確認、現状維持）
- IR・シリアライザ・保存形式（一切触らない）
- クリック接続の既存動作

## 再利用する既存コード

- `isConnectionAllowed` / `addConnectionRef` / `parseSourceHandle` / `parseTargetHandle`（`frontend/src/graph/irGraph.ts`）
- capsule互換判定 `canConnect`（`frontend/src/schema/capsules.ts`）
- 既存のE2E補助（`~/.claude/jobs/40b7f378/tmp/e2e_m4.py` 系のPlaywrightパターン、`with_server.py`）

## 検証

1. ユニットテスト: 理由メッセージ組み立て、（既存の）isConnectionAllowed回帰
2. フロントエンドゲート: `npm run lint && npm run typecheck && npm test && npm run build && npm run golden`
3. Playwright E2E（devサーバー）:
   - discovery.kubernetes の出力ハンドルから prometheus.scrape の targets 入力ハンドルへ**マウスドラッグ**（mouse.down→move→up）でエッジが作成され、IRに ref が入る（Exportで確認）
   - loki.write の出力ハンドルから prometheus.scrape の forward_to へドラッグ → エッジ不成立＋説明バナーが表示される
   - 入出力が多いコンポーネント（例 otelcol.processor.batch）でハンドルがノード内に収まっている（スクリーンショット確認）
   - Export結果が公式Alloy v1.17.1バイナリの `alloy validate` を通る
4. コミット・push後、CI（golden 3バージョンmatrix含む）green、Pages上でスモーク確認
