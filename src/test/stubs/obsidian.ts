/** Minimal stub for Vitest — Obsidian API is not published as a resolvable npm package. */

export class TFile {
  path = "";
}

export interface App {
  metadataCache: {
    getFirstLinkpathDest: (linkpath: string, sourcePath: string) => unknown;
  };
  vault: { cachedRead: (file: TFile) => Promise<string> };
}
