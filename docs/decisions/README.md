# Architecture Decision Records（ADR）

方針転換や優先順位の確定など、**戻すのが高コストな決定**を 1 ファイル 1 決定で残す。yokii-dev-workflow の「チャットだけに決めを残さない」に対応する。

## ファイル名

`NNNN-short-kebab-title.md`（例: `0001-streaming-before-wikilink.md`）。`NNNN` は連番（ゼロパディング 4 桁）。

## 新規 ADR の手順

1. [`template.md`](template.md) を複製して番号・タイトルを付ける。
2. **Status** は `Proposed` → 合意後 `Accepted`（棄却なら `Rejected` と理由）。
3. マージコミット後、末尾 **記録** にフル SHA を追記するか、次コミットで追記する（`TBD` のままにしない）。

```bash
git log -1 --format=%H -- docs/decisions/NNNN-your-title.md
```

## 索引

| ADR | 概要 |
|-----|------|
| [0001](0001-streaming-and-metadata-before-wikilink-context.md) | ロードマップ: P1+P2（ストリーミング＋メタデータ）優先、その後 P3（Wikilink コンテキスト） |
