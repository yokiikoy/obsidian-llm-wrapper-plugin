# Mission: Phase E - Model & Intelligence
> **Focus:** 思考プロセスの可視化とコスト最適化

## 📋 要件定義
- **モデル選択:** Gemini (Flash/Pro) と DeepSeek (Chat/Reasoner) をUIから即時切替。
- **Reasoning表示:** `reasoning_content` をチャットUIに表示（設定で非表示化可）。
- **非永続化:** 思考プロセスはノート（Vault）には書き込まない。

## 🛠 実装チェックリスト
- [x] `AIChatSettings` に `deepseekModel` / `geminiModel` を追加
- [x] `AIChatView` ツールバーにモデル選択ドロップダウンを実装
- [x] 推論表示トグル（`showReasoningInChat`）を設定に実装
- [x] Vault追記は本文のみ（推論は非永続）を維持

## 📝 備忘録
- 物理学の論理検証には `deepseek-reasoner` を優先。
- 日常的なタスクや要約は `gemini-2.5-flash` でコストを抑える。

## 実装状況ログ
- 2026-04-06T17:50:35+09:00: `src/settings.ts` / `src/view.ts` / `src/core/llm.ts` にモデルID切替を追加。
- 2026-04-06T17:50:35+09:00: `onReasoningChunk` 専用コールバックは未追加。既存ストリーム経路で推論表示を制御。
