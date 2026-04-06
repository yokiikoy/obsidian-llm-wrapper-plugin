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

  it("parses optional <!-- ai-chat-at --> on User and Assistant", () => {
    const md = `
### User

<!-- ai-chat-at:2026-04-06T10:00:00.000Z -->

hello

### Assistant

<!-- ai-chat-at:2026-04-06T10:00:01.000Z -->

world
`;
    const msgs = parseNoteConversation(md);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      role: "user",
      content: "hello",
      createdAt: "2026-04-06T10:00:00.000Z",
    });
    expect(msgs[1]).toEqual({
      role: "assistant",
      content: "world",
      createdAt: "2026-04-06T10:00:01.000Z",
    });
  });

  it("legacy blocks without timestamp still parse", () => {
    const md = `
### User

only

### Assistant

legacy
`;
    const msgs = parseNoteConversation(md);
    expect(msgs[0].createdAt).toBeUndefined();
    expect(msgs[1].createdAt).toBeUndefined();
  });
});
