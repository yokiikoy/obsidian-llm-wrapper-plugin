import { TFile, type App } from "obsidian";

/** `[[link]]` / `[[link|alias]]` — first segment is linkpath; depth-1 from user prompt only. */
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function extractWikilinkLinkpaths(rawPrompt: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((m = re.exec(rawPrompt)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    const linkpath = inner.split("|")[0].trim();
    if (!linkpath || seen.has(linkpath)) continue;
    seen.add(linkpath);
    ordered.push(linkpath);
  }
  return ordered;
}

export interface WikilinkContextOptions {
  enabled: boolean;
  maxCharsPerNote: number;
  maxTotalExtraChars: number;
}

const DEFAULT_LIMITS = {
  maxCharsPerNote: 12_000,
  maxTotalExtraChars: 40_000,
} as const;

export function wikilinkContextOptionsFromSettings(enabled: boolean): WikilinkContextOptions {
  return { enabled, ...DEFAULT_LIMITS };
}

/**
 * Resolves `[[wikilinks]]` in `rawPrompt` only (no recursion into linked bodies).
 * Uses `metadataCache.getFirstLinkpathDest` and `vault.cachedRead` (async, non-blocking pattern).
 */
export async function buildWikilinkContextAppendix(
  app: App,
  rawPrompt: string,
  sourcePath: string,
  options: WikilinkContextOptions
): Promise<string> {
  if (!options.enabled || !sourcePath) return "";

  const linkpaths = extractWikilinkLinkpaths(rawPrompt);
  if (linkpaths.length === 0) return "";

  const visitedPaths = new Set<string>();
  let totalUsed = 0;
  const sections: string[] = [];

  for (const linkpath of linkpaths) {
    if (totalUsed >= options.maxTotalExtraChars) {
      sections.push(
        "\n\n> [Truncated due to size limit — remaining linked notes were skipped.]\n"
      );
      break;
    }

    const dest = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!dest || !(dest instanceof TFile)) continue;

    const path = dest.path;
    if (visitedPaths.has(path)) continue;
    visitedPaths.add(path);

    const remaining = options.maxTotalExtraChars - totalUsed;
    if (remaining <= 0) break;

    let body = await app.vault.cachedRead(dest);
    const perFileCap = Math.min(options.maxCharsPerNote, remaining);
    let truncated = false;
    if (body.length > perFileCap) {
      body = body.slice(0, perFileCap);
      truncated = true;
    }
    totalUsed += body.length;

    const truncNote = truncated ? "\n\n> [Truncated due to size limit]\n" : "";
    sections.push(`### Linked note (\`${path}\`)\n\n${body}${truncNote}`);
  }

  if (sections.length === 0) return "";
  return `\n\n---\n\n## Resolved wikilink context (depth 1)\n\n${sections.join(
    "\n\n---\n\n"
  )}`;
}
