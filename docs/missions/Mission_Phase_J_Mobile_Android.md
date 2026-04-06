# Mission: Phase J - Mobile Android Support

> **Focus:** Android 版 Obsidian での手動サイドロード利用と、狭画面・モバイル WebView 向けの最小互換対応

## 要件定義

- **配布:** 手動で `main.js` / `manifest.json` / `styles.css` を Vault の `.obsidian/plugins/obsidian-ai-chat/` に配置。
- **確認:** Web Search 送信前の確認は `window.confirm` ではなく Obsidian `Modal` を使用。
- **UI:** 狭い幅でツールバーが破綻しないよう CSS で折返し・ボタンサイズ調整。
- **文書:** README に Android 導入手順、`TEST_SPEC.md` に手動検証チェックリスト。

## 実装チェックリスト

- [x] `openWebSearchConfirmModal`（Obsidian Modal）で Web Search 送信前確認
- [x] `styles.css` に狭幅向けメディアクエリ（`.ai-chat-toolbar` 等）
- [x] `README.md` に Android 手動サイドロード手順
- [x] `docs/TEST_SPEC.md` に Android 手動検証（Vitest 外）
- [x] `docs/SPEC.md` に送信フローと Modal の記述

## 実装状況ログ

- 2026-04-06T19:09:01+09:00: Phase J を起票。Web Search 確認を Modal 化、モバイル向け CSS、README / TEST_SPEC / SPEC を更新。
