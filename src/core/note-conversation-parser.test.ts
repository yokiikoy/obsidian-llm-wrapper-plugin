import { describe, expect, it } from "vitest";
import { parseNoteConversation, stripYamlFrontmatter } from "./note-conversation-parser";

describe("parseNoteConversation", () => {
  it("parses User and Assistant blocks", () => {
    const md = `
### User

hello

### Assistant

world
`;
    const msgs = parseNoteConversation(md);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "user", content: "hello" });
    expect(msgs[1]).toEqual({ role: "assistant", content: "world" });
  });

  it("skips YAML frontmatter before parsing", () => {
    const md = `---
title: x
---

### User

a

### Assistant

b
`;
    const msgs = parseNoteConversation(md);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("a");
  });

  it("stripYamlFrontmatter leaves body without frontmatter", () => {
    const s = stripYamlFrontmatter(`---\nx: 1\n---\n\nbody`);
    expect(s.trim()).toBe("body");
  });
});
