import { describe, expect, it } from "vitest";
import { extractWikilinkLinkpaths } from "./wikilink-context";

describe("extractWikilinkLinkpaths", () => {
  it("returns empty for no brackets", () => {
    expect(extractWikilinkLinkpaths("hello")).toEqual([]);
  });

  it("extracts simple link", () => {
    expect(extractWikilinkLinkpaths("see [[Note A]]")).toEqual(["Note A"]);
  });

  it("uses path part before pipe", () => {
    expect(extractWikilinkLinkpaths("[[Real|Alias]]")).toEqual(["Real"]);
  });

  it("dedupes preserving first order", () => {
    expect(extractWikilinkLinkpaths("[[A]] then [[A]] and [[B]]")).toEqual(["A", "B"]);
  });

  it("trims inner whitespace", () => {
    expect(extractWikilinkLinkpaths("[[  spaced  ]]")).toEqual(["spaced"]);
  });
});
