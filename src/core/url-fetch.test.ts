import { describe, expect, it } from "vitest";
import { extractUrls } from "./url-fetch";

describe("extractUrls", () => {
  it("finds unique http(s) URLs", () => {
    const t = "See https://a.com/x and https://b.com also https://a.com/x";
    expect(extractUrls(t)).toEqual(["https://a.com/x", "https://b.com"]);
  });

  it("returns empty when no URLs", () => {
    expect(extractUrls("no links")).toEqual([]);
  });
});
