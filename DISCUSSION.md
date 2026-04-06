# DISCUSSION — 設計メモ・議論の置き場

チャット上の長いやりとりの**要約・未確定の論点**をここに残す。確定した**不可逆な決定**は [`docs/decisions/`](docs/decisions/) の ADR に移す（yokii-dev-workflow）。

## 使い方

1. スレッドが長くなったら、**結論 3 行**と**未決事項**を追記する。
2. 「これで進む」と合意したら、該当トピック用の ADR を追加し、ここから ADR へリンクする。
3. 数値・実験まとめは必要に応じて [`EVAL.md`](EVAL.md) に書く。
4. ワークフローとファイルの対応表は [`docs/RECORDS.md`](docs/RECORDS.md)。

## 索引（ADR へ）

| 日付 | トピック | 記録 |
|------|----------|------|
| 2026-04-06 | ロードマップ着手順（P1+P2 vs P3） | [ADR 0001](docs/decisions/0001-streaming-and-metadata-before-wikilink-context.md) |
| 2026-04-06 | View と `ChatSession` の責務分離 | [`docs/SPEC.md`](docs/SPEC.md) §5.6（実装コミット例: `fff7e5d`） |
| 2026-04-06 | Phase E→G→D（モデル・再水和・URL） | [ADR 0002](docs/decisions/0002-phase-egd-model-hydration-url.md) |

## メモ（自由記述）

### 2026-04-06 — Phase A（P1+P2）実装までの経緯（要約）

**結論（3 行）**

- 先に **ストリーミング＋中止＋完了時メタデータ（usage / reasoning 表示）** を一塊で入れ、その後に **Wikilink コンテキスト（P3）** を載せる順序で合意（ADR 0001）。
- 実装は `LlmClient.stream` に統一（DeepSeek: `stream_options.include_usage`、Gemini: `streamGenerateContent?alt=sse`）、View 側は Stop / `AbortController`、ストリーム中はプレーン表示→完了後のみ `MarkdownRenderer`、**ノート追記が成功したターンだけ** `messages` を更新する原子性を維持。
- 実装の記録コミットは ADR 0001 の「記録」欄および [`docs/SPEC.md`](docs/SPEC.md) 変更履歴を参照（例: `00eb3f85…`）。

**実装スコープ外（この時点）**

- P3: Vault 内 `[[wikilink]]` の本文連結・送信ペイロード拡張。
- ADR の P2 文言にある `finish_reason` は **Phase A の型・UI には含めず** usage 中心にした（必要なら後続で拡張）。

**レビューで残した未決・深掘り候補（メモ）**

- Gemini SSE の累積テキスト分岐（`textAggregate` の `else` 枝）を実 API で十分に検証したか。
- 現行の送信順は **`MarkdownRenderer` 成功のあと `appendToLockedNote`** のため、「追記失敗でファイルに無いのに履歴 DOM にだけ応答が残る」系の UX を許容するか、緩和するかは製品判断。
- 旧コンサル用コピーは [`docs/archive/SPEC.consulting.md`](docs/archive/SPEC.consulting.md) にアーカイブ済み。現行は [`docs/SPEC.md`](docs/SPEC.md) を正とする。
