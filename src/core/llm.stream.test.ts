import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLlmClient } from "./llm";

function textEncoderStream(parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
}

describe("createLlmClient stream (fetch mocked)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects when DeepSeek API key empty", async () => {
    const client = createLlmClient({
      provider: "deepseek",
      deepseekApiKey: "  ",
      geminiApiKey: "x",
    });
    await expect(
      client.stream(
        [],
        { temperature: 0, systemPrompt: "" },
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow("DeepSeek API key is empty");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects when Gemini API key empty", async () => {
    const client = createLlmClient({
      provider: "gemini",
      deepseekApiKey: "x",
      geminiApiKey: "",
    });
    await expect(
      client.stream(
        [],
        { temperature: 0, systemPrompt: "" },
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow("Gemini API key is empty");
  });

  it("DeepSeek merges deltas and usage", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        textEncoderStream([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
          'data: {"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    const client = createLlmClient({
      provider: "deepseek",
      deepseekApiKey: "sk-test",
      geminiApiKey: "",
    });
    const textChunks: string[] = [];
    const out = await client.stream(
      [{ role: "user", content: "hi" }],
      { temperature: 0.5, systemPrompt: "sys" },
      (t, _r) => textChunks.push(t),
      new AbortController().signal
    );
    expect(out.content).toBe("Hello world");
    expect(out.reasoning).toBe("");
    expect(out.usage).toEqual({ promptTokens: 3, completionTokens: 5 });
    expect(textChunks).toEqual(["Hello", " world"]);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.method).toBe("POST");
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("DeepSeek usage-only completion when tokens reported", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(textEncoderStream(['data: {"usage":{"prompt_tokens":1,"completion_tokens":0}}\n\n']), {
        status: 200,
      })
    );
    const client = createLlmClient({
      provider: "deepseek",
      deepseekApiKey: "k",
      geminiApiKey: "",
    });
    const out = await client.stream(
      [],
      { temperature: 0, systemPrompt: "" },
      () => {},
      new AbortController().signal
    );
    expect(out.content).toBe("");
    expect(out.usage.promptTokens).toBe(1);
  });

  it("DeepSeek throws on HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad" } }), { status: 401 })
    );
    const client = createLlmClient({
      provider: "deepseek",
      deepseekApiKey: "k",
      geminiApiKey: "",
    });
    await expect(
      client.stream([], { temperature: 0, systemPrompt: "" }, () => {}, new AbortController().signal)
    ).rejects.toThrow("bad");
  });

  it("DeepSeek throws empty stream without usage tokens", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(textEncoderStream(['data: {"choices":[{}]}\n\n']), { status: 200 })
    );
    const client = createLlmClient({
      provider: "deepseek",
      deepseekApiKey: "k",
      geminiApiKey: "",
    });
    await expect(
      client.stream([], { temperature: 0, systemPrompt: "" }, () => {}, new AbortController().signal)
    ).rejects.toThrow("DeepSeek: empty stream");
  });

  it("Gemini cumulative then longer prefix", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        textEncoderStream([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello world"}]}}]}\n\n',
          'data: {"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2}}\n\n',
        ]),
        { status: 200 }
      )
    );
    const client = createLlmClient({
      provider: "gemini",
      deepseekApiKey: "",
      geminiApiKey: "g",
    });
    const deltas: string[] = [];
    const out = await client.stream(
      [{ role: "user", content: "hi" }],
      { temperature: 0, systemPrompt: "" },
      (t, _r) => deltas.push(t),
      new AbortController().signal
    );
    expect(out.content).toBe("Hello world");
    expect(deltas).toEqual(["Hello", " world"]);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("streamGenerateContent");
    expect(url).toContain("alt=sse");
  });

  it("Gemini pure delta chunks after first", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        textEncoderStream([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}\n\n',
        ]),
        { status: 200 }
      )
    );
    const client = createLlmClient({
      provider: "gemini",
      deepseekApiKey: "",
      geminiApiKey: "g",
    });
    const out = await client.stream(
      [],
      { temperature: 0, systemPrompt: "" },
      () => {},
      new AbortController().signal
    );
    expect(out.content).toBe("Hi there");
  });

  it("Gemini attaches google_search tool when enableWebSearch is true", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        textEncoderStream(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n']),
        { status: 200 }
      )
    );
    const client = createLlmClient({
      provider: "gemini",
      deepseekApiKey: "",
      geminiApiKey: "g",
    });
    await client.stream(
      [{ role: "user", content: "latest news" }],
      { temperature: 0, systemPrompt: "", enableWebSearch: true },
      () => {},
      new AbortController().signal
    );
    const init = vi.mocked(fetch).mock.calls[0][1];
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.tools).toEqual([{ google_search: {} }]);
  });
});
