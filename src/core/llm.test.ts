import { describe, expect, it } from "vitest";
import { isAbortError, limitChatMessagesForApiWindow, type ChatMessage } from "./llm";

describe("limitChatMessagesForApiWindow", () => {
  const u = (content: string): ChatMessage => ({ role: "user", content });
  const a = (content: string): ChatMessage => ({ role: "assistant", content });

  it("returns empty array when maxCount < 1", () => {
    expect(limitChatMessagesForApiWindow([u("x")], 0)).toEqual([]);
  });

  it("returns copy when within limit", () => {
    const m = [u("1"), a("2")];
    const out = limitChatMessagesForApiWindow(m, 10);
    expect(out).toEqual(m);
    expect(out).not.toBe(m);
  });

  it("keeps last maxCount messages", () => {
    const m = [u("1"), a("2"), u("3"), a("4"), u("5")];
    expect(limitChatMessagesForApiWindow(m, 3)).toEqual([u("3"), a("4"), u("5")]);
  });

  it("drops leading assistant run after slice", () => {
    const m = [u("1"), a("2"), a("3"), u("4"), a("5")];
    expect(limitChatMessagesForApiWindow(m, 3)).toEqual([u("4"), a("5")]);
  });

  it("treats system like other messages in slice; may trim leading assistant", () => {
    const sys: ChatMessage = { role: "system", content: "sys" };
    const m = [sys, u("1"), a("2"), u("3")];
    // last 2: [a("2"), u("3")] → leading assistant dropped → [u("3")]
    expect(limitChatMessagesForApiWindow(m, 2)).toEqual([u("3")]);
  });
});

describe("isAbortError", () => {
  it("returns true for Error with name AbortError", () => {
    const e = new Error("x");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });

  it("returns true for plain object with name AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
