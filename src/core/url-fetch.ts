import { requestUrl } from "obsidian";

const URL_RE = /https?:\/\/[^\s<>()[\]{}'"`]+/gi;

const MAX_URLS = 5;
const MAX_CHARS_PER_PAGE = 12_000;

export function extractUrls(text: string): string[] {
  const found = text.matchAll(URL_RE);
  return [...new Set([...found].map((x) => x[0]))].slice(0, MAX_URLS);
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  return doc.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * Fetches http(s) URLs found in `rawInput`, extracts plain text, and returns markdown
 * to append to the user turn (before wikilink resolution).
 */
export async function fetchUrlsAppendix(
  rawInput: string,
  onStatus: (msg: string) => void
): Promise<string> {
  const urls = extractUrls(rawInput);
  if (urls.length === 0) return "";
  const parts: string[] = [];
  for (const url of urls) {
    onStatus(`AI Chat: fetching ${url}…`);
    try {
      const res = await requestUrl({ url });
      const text = htmlToPlainText(res.text).slice(0, MAX_CHARS_PER_PAGE);
      if (text) {
        parts.push(`### ${url}\n\n${text}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onStatus(`AI Chat: could not fetch ${url}${msg ? `: ${msg}` : ""}`);
    }
  }
  if (parts.length === 0) return "";
  return `\n\n---\n\n**Fetched page content:**\n\n${parts.join("\n\n")}`;
}
