# Mission: Phase I - Chat Toolbar Overhaul
> **Focus:** ツールバーをコントロール・パネル化し、モデル・機能・外部リンクを直感操作に統合する

## 📋 要件定義
- **モデル統合:** ツールバーで Provider + Model を一体選択（Gemini / DeepSeek）。
- **機能トグル:** Web Search / URL Fetch をツールバー上で ON/OFF。
- **制約:** DeepSeek 選択時は Web Search を無効化（disabled）。
- **永続化:** ツールバー変更は即時 `plugin.saveSettings()` で保存。

## 🛠 実装チェックリスト
- [x] `src/settings.ts` に `enableWebSearch` / `enableUrlFetch` を追加
- [x] `src/view.ts` ツールバーを再設計（統合モデル選択 + トグル + 外部リンク）
- [x] `src/core/chat-session.ts` で URL Fetch を設定連動化
- [x] `src/core/llm.ts` で Gemini 時の `tools.google_search` 付与を実装
- [x] DeepSeek 選択時の Web Search 無効化（UI と送信経路の両面）を確認
- [x] テスト更新（`chat-session.test.ts` と `llm.stream.test.ts`）
- [x] `docs/SPEC.md` を更新

## 📝 備忘録
- Gemini Web Search は Gemini API の `tools: [{ google_search: {} }]` を利用。
- URL Fetch の既存 Phase D 動作は `enableUrlFetch` で制御し、既定 ON を維持。

## 実装状況ログ
- 2026-04-06T18:39:31+09:00: Phase I を起票。ツールバー再設計（モデル統合・トグル・外部リンク）を開始。
- 2026-04-06T18:45:16+09:00: 実装完了。統合モデル選択、Web Search / URL Fetch トグル、Gemini Web / AI Studio リンク、Gemini `google_search` tool 連携、URL Fetch トグル制御、関連テストと SPEC を更新。
- 2026-04-06T18:52:10+09:00: Web Search ON + Gemini 送信時に毎回確認ダイアログ（confirm）を追加。Cancel 時は送信中止。
