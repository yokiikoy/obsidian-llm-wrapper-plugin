# 次エージェント向け引き継ぎ（短時間・低トークン）

**目的:** 会話コンテキストを汚さず、次のコーディングエージェントが **最小読込**で作業を再開できるようにする。

---

## いまのリリース

| 項目 | 値 |
|------|-----|
| バージョン | **1.2.0**（`manifest.json` / `package.json` と一致） |
| 直近の主な変更 | トークンベース送信前チェック、`TokenLimitModal`、画面上の **推定プロンプトトークン表示**（`view.ts` の `ai-chat-token-estimate`） |

---

## 読む順（トークン節約）

1. **このファイル**（本書）— 1 通で足りる想定  
2. 仕様の詳細が必要なときだけ **[`docs/SPEC.md`](SPEC.md)** の該当節（§5 LLM、§6 View）  
3. レビュー観点の一覧は **[`docs/REPORT_REVIEW_HANDOFF.md`](REPORT_REVIEW_HANDOFF.md)**（長いので必要時のみ）

**避ける:** リポジトリ全体の貼り付け、過去チャットログの丸ごと再掲。変更は **grep / 該当ファイルのみ読込** で十分なことが多い。

---

## ソースの地図（触る場所の目安）

| 領域 | パス |
|------|------|
| 送信・UI・トークン表示・Modal 呼び出し | `src/view.ts` |
| 上限 Modal | `src/token-limit-modal.ts` |
| トークン推計・上限定数・ストリーム | `src/core/llm.ts` |
| ウィキリンク追記 | `src/core/wikilink-context.ts` |
| 設定 | `src/settings.ts` |
| 仕様の正 | `docs/SPEC.md` |

単体テスト: `src/core/*.test.ts` — `npm test`

---

## 既知の注意（短く）

- トークン数は **推定**（`estimateTokens` = 文字長 ×1.1）。実 API のトークンと一致しない。  
- 画面上の推計は **wikilink 解決後の本文を含めない**（送信直前の `userContent` より小さく見えることがある）。  
- Gemini 経路は **`reasoning` を常に空**（DeepSeek の `reasoning_content` のみ UI に反映）。  
- モデル名はコード内固定（例: `deepseek-chat`, `gemini-1.5-flash`）。

---

## ビルド

```bash
npm install   # 初回のみ
npm test && npm run build && npx tsc --noEmit
```

---

## 更新ルール

作業完了時に **仕様や挙動を変えたら `docs/SPEC.md` を更新**し、バージョンを上げるなら `manifest.json` / `package.json` / `package-lock.json`（ルート）/ README の Version 行を揃える。

---

*このファイルは v1.2.0 リリース時点で作成。以降の変更はコミット履歴と SPEC を正とする。*
