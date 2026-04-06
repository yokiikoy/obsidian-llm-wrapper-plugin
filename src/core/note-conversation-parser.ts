import type { ChatMessage } from "./llm";

/** Strips a leading YAML `---` … `---` block if present. */
export function stripYamlFrontmatter(markdown: string): string {
  const t = markdown.trimStart();
  if (!t.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---\n", 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 5);
}

/**
 * Parses `### User` / `### Assistant` blocks (same headings as vault append in SPEC).
 * Content runs until the next same-level heading or EOF.
 */
export function parseNoteConversation(markdown: string): ChatMessage[] {
  const body = stripYamlFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const out: ChatMessage[] = [];
  let i = 0;
  const header = /^### (User|Assistant)\s*$/;
  while (i < lines.length) {
    const hm = lines[i].match(header);
    if (!hm) {
      i += 1;
      continue;
    }
    const role = hm[1].toLowerCase() === "user" ? "user" : "assistant";
    i += 1;
    const contentLines: string[] = [];
    while (i < lines.length && !header.test(lines[i])) {
      contentLines.push(lines[i]);
      i += 1;
    }
    out.push({ role, content: contentLines.join("\n").trim() });
  }
  return out;
}
