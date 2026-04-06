import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { ChatSession, type ChatSessionDelegate, type VaultAdapter } from "./chat-session";
import type { AIChatSettings } from "../settings";
import type { ChatMessage, LlmClient, StreamResult } from "./llm";
import * as llm from "./llm";

function makeFile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

function baseSettings(): AIChatSettings {
  return {
    provider: "deepseek",
    deepseekApiKey: "sk-test",
    geminiApiKey: "",
    systemPrompt: "You are a helpful assistant inside Obsidian.",
    temperature: 0.7,
    enableWikilinkContextResolution: false,
  };
}

function makeVault(appendSpy: ReturnType<typeof vi.fn>): VaultAdapter {
  return {
    resolveFile: (path: string) => makeFile(path),
    appendToFile: appendSpy,
    buildWikilinkContext: vi.fn(async () => ""),
  };
}

function makeDelegate(): ChatSessionDelegate & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onSendStarting: vi.fn(async () => {}),
    onStreamChunk: vi.fn(),
    onStreamFinished: vi.fn(async () => {}),
    onTurnComplete: vi.fn(),
    onTurnRolledBack: vi.fn(),
    onLoadingChanged: vi.fn(),
    onMessagesChanged: vi.fn(),
    onSessionCleared: vi.fn(),
    promptTokenLimitChoice: vi.fn(),
    showNotice: vi.fn(),
  };
}

describe("ChatSession", () => {
  let settings: AIChatSettings;

  beforeEach(() => {
    settings = baseSettings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends to vault and updates messages on successful stream", async () => {
    const appendSpy = vi.fn(async () => {});
    const vault = makeVault(appendSpy);
    const delegate = makeDelegate();
    const result: StreamResult = {
      content: "Hello",
      reasoning: "",
      usage: { promptTokens: 1, completionTokens: 1 },
    };
    const client: LlmClient = {
      stream: vi.fn(async (_m, _o, onChunk) => {
        onChunk("Hello", "");
        return result;
      }),
    };
    const session = new ChatSession(vault, delegate, () => settings, () => client);
    const note = makeFile("note.md");
    session.lockTarget(note);

    await session.send("hi", "");

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const appendArgs = appendSpy.mock.calls[0] as unknown as [TFile, string];
    const appended = appendArgs[1];
    expect(appended).toContain("### User");
    expect(appended).toContain("hi");
    expect(appended).toContain("### Assistant");
    expect(appended).toContain("Hello");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toEqual({ role: "user", content: "hi" });
    expect(session.messages[1]).toEqual({ role: "assistant", content: "Hello" });
    expect(delegate.onTurnComplete).toHaveBeenCalled();
    expect(delegate.onTurnRolledBack).not.toHaveBeenCalled();
  });

  it("rolls back UI and does not persist messages on AbortError", async () => {
    const appendSpy = vi.fn(async () => {});
    const vault = makeVault(appendSpy);
    const delegate = makeDelegate();
    const client: LlmClient = {
      stream: vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }),
    };
    const session = new ChatSession(vault, delegate, () => settings, () => client);
    session.lockTarget(makeFile("note.md"));

    await session.send("x", "");

    expect(appendSpy).not.toHaveBeenCalled();
    expect(session.messages).toHaveLength(0);
    expect(delegate.onTurnRolledBack).toHaveBeenCalled();
    expect(delegate.showNotice).not.toHaveBeenCalled();
  });

  it("calls promptTokenLimitChoice when estimated prompt exceeds limit", async () => {
    vi.spyOn(llm, "estimatePromptTokens").mockReturnValue(200_000);
    const appendSpy = vi.fn(async () => {});
    const vault = makeVault(appendSpy);
    const delegate = makeDelegate();
    vi.mocked(delegate.promptTokenLimitChoice).mockResolvedValue("cancel");
    const client: LlmClient = {
      stream: vi.fn(async () => ({
        content: "x",
        reasoning: "",
        usage: { promptTokens: 0, completionTokens: 0 },
      })),
    };
    const session = new ChatSession(vault, delegate, () => settings, () => client);
    session.lockTarget(makeFile("n.md"));

    await session.send("long", "");

    expect(delegate.promptTokenLimitChoice).toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(client.stream).not.toHaveBeenCalled();
  });

  it("truncates history when user chooses truncate, then streams successfully", async () => {
    vi.spyOn(llm, "estimatePromptTokens").mockImplementation((msgs) => {
      const n = msgs.length;
      if (n >= 4) return 200_000;
      return 50_000;
    });
    const appendSpy = vi.fn(async () => {});
    const vault = makeVault(appendSpy);
    const delegate = makeDelegate();
    vi.mocked(delegate.promptTokenLimitChoice).mockResolvedValueOnce("truncate");
    const result: StreamResult = {
      content: "Hello",
      reasoning: "",
      usage: { promptTokens: 1, completionTokens: 1 },
    };
    const client: LlmClient = {
      stream: vi.fn(async (_m, _o, onChunk) => {
        onChunk("Hello", "");
        return result;
      }),
    };
    const session = new ChatSession(vault, delegate, () => settings, () => client);
    session.lockTarget(makeFile("note.md"));
    const internal = session as unknown as { _messages: ChatMessage[] };
    internal._messages = [
      { role: "user", content: "old-u1" },
      { role: "assistant", content: "old-a1" },
      { role: "user", content: "old-u2" },
      { role: "assistant", content: "old-a2" },
    ];

    await session.send("hi", "");

    expect(delegate.promptTokenLimitChoice).toHaveBeenCalledTimes(1);
    expect(delegate.onMessagesChanged).toHaveBeenCalled();
    expect(client.stream).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(session.messages).toHaveLength(4);
    expect(session.messages[0]).toEqual({ role: "user", content: "old-u2" });
    expect(session.messages[1]).toEqual({ role: "assistant", content: "old-a2" });
    expect(session.messages[2]).toEqual({ role: "user", content: "hi" });
    expect(session.messages[3]).toEqual({ role: "assistant", content: "Hello" });
    expect(delegate.onTurnComplete).toHaveBeenCalled();
    expect(delegate.onTurnRolledBack).not.toHaveBeenCalled();
  });

  it("rolls back and does not update messages when appendToFile rejects", async () => {
    const appendSpy = vi.fn(async () => {
      throw new Error("append failed");
    });
    const vault = makeVault(appendSpy);
    const delegate = makeDelegate();
    const result: StreamResult = {
      content: "Hello",
      reasoning: "",
      usage: { promptTokens: 1, completionTokens: 1 },
    };
    const client: LlmClient = {
      stream: vi.fn(async (_m, _o, onChunk) => {
        onChunk("Hello", "");
        return result;
      }),
    };
    const session = new ChatSession(vault, delegate, () => settings, () => client);
    session.lockTarget(makeFile("note.md"));

    await session.send("hi", "");

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(session.messages).toHaveLength(0);
    expect(delegate.onTurnRolledBack).toHaveBeenCalled();
    expect(delegate.onTurnComplete).not.toHaveBeenCalled();
    expect(delegate.showNotice).toHaveBeenCalledWith("AI Chat: append failed");
  });

  it("rolls back when locked file disappears after stream before append", async () => {
    let resolveCalls = 0;
    const vault: VaultAdapter = {
      resolveFile: vi.fn((path: string) => {
        resolveCalls += 1;
        return resolveCalls === 1 ? makeFile(path) : null;
      }),
      appendToFile: vi.fn(async () => {}),
      buildWikilinkContext: vi.fn(async () => ""),
    };
    const delegate = makeDelegate();
    const result: StreamResult = {
      content: "Hello",
      reasoning: "",
      usage: { promptTokens: 1, completionTokens: 1 },
    };
    const client: LlmClient = {
      stream: vi.fn(async (_m, _o, onChunk) => {
        onChunk("Hello", "");
        return result;
      }),
    };
    const session = new ChatSession(vault, delegate, () => settings, () => client);
    session.lockTarget(makeFile("gone.md"));

    await session.send("hi", "");

    expect(vault.resolveFile).toHaveBeenCalledTimes(2);
    expect(vault.appendToFile).not.toHaveBeenCalled();
    expect(session.messages).toHaveLength(0);
    expect(delegate.onTurnRolledBack).toHaveBeenCalled();
    expect(delegate.showNotice).toHaveBeenCalledWith(
      "AI Chat: Target note no longer exists; cannot append."
    );
  });
});
