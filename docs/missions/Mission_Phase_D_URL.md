# Mission: Phase D - Smart Ingester (URL Fetch)
> **Focus:** 外部知識の「Deep Research」への統合

## 📋 要件定義
- **URL抽出:** 送信前に正規表現でURLを検知。
- **シーケンシャル処理:** 複数URLを直列で1つずつフェッチ（Obsidian `requestUrl`）。
- **本文抽出:** `DOMParser` ベースで本文を純化し、入力へ連結。
- **進捗通知:** フェッチ中・失敗は Notice で通知。

## 🛠 実装チェックリスト
- [x] `ChatSession.send()` 内にフェッチ・パイプラインを構築
- [x] URL抽出・重複排除ロジックの実装
- [x] `src/core/url-fetch.ts` を実装（直列 `requestUrl`）
- [x] 失敗時はURL単位でスキップし処理継続（Notice表示）

## 実装状況ログ
- 2026-04-06T17:50:35+09:00: `extractUrls`（重複排除 + 最大件数）と本文連結処理を追加。
- 2026-04-06T17:50:35+09:00: Readability.js 導入は未採用。現状は `DOMParser + innerText` の軽量方式。
