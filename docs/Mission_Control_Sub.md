# 🚀 Mission Control: Obsidian AI Chat
> **Status:** Phase D–H Implemented (2026-04-06)
> **Role:** Intelligent Hub (Process Layer of Yuichi's Ecosystem)

## 🎯 Active Missions
- [x] **Phase E:** Model & Intelligence (feature/phase-e-model-intelligence)
- [x] **Phase D:** Smart Ingester / URL Fetch (feature/phase-d-smart-ingester)
- [x] **Phase G:** Session Hydration / 再水和 (feature/phase-g-session-hydration)
- [x] **Phase H:** Repository-managed Mission Docs (feature/phase-h-repo-managed-missions)
- [x] **Phase I:** Chat Toolbar Overhaul (feature/phase-i-toolbar-overhaul)

## 📊 Project Roadmap
1. **Phase 0: Refactoring** (Done) - ChatSessionへの分離、テスト基盤構築。
2. **Phase E: 知能の制御** (Done) - モデル切替・思考プロセスの可視化。
3. **Phase D: 情報の召喚** (Done) - URLフェッチ・本文抽出の実装。
4. **Phase G: 記憶の永続** (Done) - ノートからの会話復元。
5. **Phase H: Mission 文書の Git 管理** (Done) - `docs/missions` 正本・Vault symlink・運用ルール（`README`）。
6. **Phase I: ツールバー再設計** (Done) - モデル統合、Web Search / URL Fetch トグル、外部リンク導線。

## 📈 Billing & Resources
- **Budget Limit:** ¥5,000 / month
- **Current Usage:** [Billing_Log.md](Billing_Log.md) 参照
- **Safety Brake:** Google Cloud Billing Alert (50%, 80%, 100%)

## 📂 Documentation
- [[ADR/0001_Use_ChatSession|ADR 0001: ChatSessionの導入]]
- [[ADR/0002_Emoji_Signatures|ADR 0002: 絵文字シグネチャの採用]]
- [GitNexus Impact Analysis](https://github.com/...)

## 実装状況ログ
- 2026-04-06T17:50:35+09:00: E/G/D の本体実装を適用（モデル切替、再水和、URL fetch）。
- 2026-04-06T17:50:35+09:00: リポジトリ側の実装コミットは `faccfb4`、ADR記録更新は `d535299`。
- 2026-04-06T18:06:48+09:00: Phase G — Load note 排他（送信中再水和不可・多重実行抑止）を反映。`Mission_Phase_G_Hydration` のチェックリスト・ログを更新。
- 2026-04-06T18:15:41+09:00: Phase H を追加。Mission 文書の Git 管理運用（symlink 方式）をアクティブ化。
- 2026-04-06T18:21:06+09:00: Phase H 未了を完了。`docs/missions/README.md` で運用ルールを明文化、`.bak-*` は作成から 30 日で削除可とした。`Mission_Phase_H` を更新。
- 2026-04-06T18:22:52+09:00: Phase H を Mission Control 上で完了扱いに更新（Active `[x]`、Roadmap へ Phase H 追加、Status を D–H に統一）。
- 2026-04-06T18:39:31+09:00: Phase I を起票。`Mission_Phase_I_Toolbar` を追加し、Toolbar Overhaul の実装着手。
- 2026-04-06T18:45:16+09:00: Phase I 実装を完了。Active/Roadmap を Done 化し、Web Search・URL Fetch トグルと統合モデル選択を反映。
- 2026-04-06T18:52:10+09:00: Web Search ON + Gemini 送信時に毎回確認ダイアログ（confirm）を追加。Cancel 時は送信中止。
