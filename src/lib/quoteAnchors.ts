export type QuoteSpan = {
  draftId: string;
  start: number;
  end: number;
};

export type QuoteSegment =
  | { type: "text"; key: string; value: string }
  | { type: "quote"; key: string; draftId: string; value: string };

export const MIN_HIGHLIGHT_CHARS = 4;

const PRIORITY_ENTITIES = [
  "Faith Westman",
  "Ronda Marsh",
  "Cecil Smith",
  "Fred Murray",
  "Butch Atwood",
  "Maura Murray",
  "Kathleen Murray",
  "Weathered Barn",
  "Haverhill",
  "Route 112",
  "Bradley Hill Road",
  "Wild Ammonoosuc Road",
  "Case F 04-1514",
  "9-1-1 Dispatcher",
  "Bath",
];

function compactWithMap(source: string) {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (out.endsWith(" ")) continue;
      map.push(i);
      out += " ";
    } else {
      map.push(i);
      out += ch.toLowerCase();
    }
  }
  return { out, map };
}

export function isUsableHighlightNeedle(snippet: string) {
  const t = snippet.replace(/\s+/g, " ").trim();
  if (t.length < MIN_HIGHLIGHT_CHARS) return false;
  const compact = t.replace(/[^A-Za-z0-9]/g, "");
  if (compact.length < 3) return false;
  if (/^(yes|ok|no|fw|g\d+)[.:]?$/i.test(t)) return false;
  return true;
}

function uniqueNeedles(parts: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const t = String(part || "").replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Prefer the card's explicit contiguous quote; never prefix-match fragments. */
export function highlightNeedles(parts: Array<string | undefined | null>): string[] {
  const explicit = uniqueNeedles(parts).filter(isUsableHighlightNeedle);
  const blob = explicit.join(" ");
  const extras: string[] = [];
  for (const ent of PRIORITY_ENTITIES) {
    if (blob.includes(ent) || blob.toLowerCase().includes(ent.toLowerCase())) extras.push(ent);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...explicit, ...extras]) {
    const key = t.toLowerCase();
    if (seen.has(key) || !isUsableHighlightNeedle(t)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => b.length - a.length);
}

export function locateAnySnippet(haystack: string, parts: Array<string | undefined | null>) {
  return locateCardHighlight(haystack, { quote: parts[0] || "", snippet: parts[1], title: parts[2], exactQuote: parts[0] });
}

export function locateCardHighlight(
  haystack: string,
  card: { quote?: string; snippet?: string; exactQuote?: string; anchorText?: string; title?: string },
) {
  const explicit = uniqueNeedles([card.exactQuote, card.quote, card.snippet]);
  for (const needle of explicit) {
    const loc = locateSnippet(haystack, needle);
    if (loc) return loc;
  }
  if (explicit.length) return null;
  const named = uniqueNeedles([card.anchorText]);
  for (const needle of named) {
    const loc = locateSnippet(haystack, needle);
    if (loc) return loc;
  }
  const blob = `${named.join(" ")} ${card.title || ""}`;
  for (const ent of PRIORITY_ENTITIES) {
    if (!blob.includes(ent) && !blob.toLowerCase().includes(ent.toLowerCase())) continue;
    const loc = locateSnippet(haystack, ent);
    if (loc) return loc;
  }
  const title = String(card.title || "").replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (title && isUsableHighlightNeedle(title)) return locateSnippet(haystack, title);
  return null;
}

/** Locate a card quote in source text. Full phrase only — no prefix / fragment matches. */
export function locateSnippet(haystack: string, snippet: string): { start: number; end: number } | null {
  const needle = snippet.replace(/\s+/g, " ").trim();
  if (!isUsableHighlightNeedle(needle)) return null;

  const exact = haystack.indexOf(needle);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  const hayLower = haystack.toLowerCase();
  const needleLower = needle.toLowerCase();
  const folded = hayLower.indexOf(needleLower);
  if (folded >= 0) return { start: folded, end: folded + needle.length };

  const h = compactWithMap(haystack);
  const n = compactWithMap(needle).out.trim();
  if (n.length < MIN_HIGHLIGHT_CHARS) return null;
  const idx = h.out.indexOf(n);
  if (idx < 0 || h.map[idx] === undefined) return null;
  const last = idx + n.length - 1;
  if (last >= h.map.length) return null;
  return { start: h.map[idx], end: h.map[last] + 1 };
}

const PAGE_WEIGHT = 100_000;

export function pageAtOffset(text: string, startIndex: number) {
  let pageNumber = 1;
  let pageStart = 0;
  const window = text.slice(0, Math.max(0, startIndex));
  const re = /--- Page (\d+) ---/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(window))) {
    pageNumber = Number.parseInt(match[1], 10) || pageNumber;
    pageStart = match.index ?? pageStart;
  }
  return {
    pageNumber,
    characterOffset: Math.max(0, startIndex - pageStart),
  };
}

export function narrativeSortKey(text: string, snippet: string) {
  const loc = locateSnippet(text, snippet);
  if (!loc) return Number.POSITIVE_INFINITY;
  const { pageNumber, characterOffset } = pageAtOffset(text, loc.start);
  return pageNumber * PAGE_WEIGHT + characterOffset;
}

export function sortByNarrativeOrder<T extends { id: string; snippet: string; title?: string; timestamp?: number }>(
  drafts: T[],
  resolveText: string | ((draft: T) => string),
): T[] {
  const keys = new Map<string, number>();
  for (const draft of drafts) {
    const text = typeof resolveText === "function" ? resolveText(draft) : resolveText;
    let key = narrativeSortKey(text, draft.snippet);
    if (!Number.isFinite(key) && draft.title) key = narrativeSortKey(text, draft.title);
    keys.set(draft.id, key);
  }
  return [...drafts].sort((a, b) => {
    const diff = (keys.get(a.id) ?? Number.POSITIVE_INFINITY) - (keys.get(b.id) ?? Number.POSITIVE_INFINITY);
    if (diff !== 0) return diff;
    return (a.timestamp ?? 0) - (b.timestamp ?? 0);
  });
}

export function collectQuoteSpans(
  text: string,
  drafts: { id: string; snippet: string; title?: string; exactQuote?: string; anchorText?: string }[],
): QuoteSpan[] {
  const found: QuoteSpan[] = [];
  const ranked = [...drafts].sort((a, b) => (b.exactQuote || b.snippet).trim().length - (a.exactQuote || a.snippet).trim().length);
  for (const d of ranked) {
    const loc = locateCardHighlight(text, d);
    if (!loc) continue;
    if (found.some((span) => loc.start < span.end && loc.end > span.start)) continue;
    found.push({ draftId: d.id, start: loc.start, end: loc.end });
  }
  return found.sort((a, b) => a.start - b.start);
}

export function splitTextBySpans(text: string, spans: QuoteSpan[]): QuoteSegment[] {
  const parts: QuoteSegment[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) {
      parts.push({ type: "text", key: `t-${cursor}`, value: text.slice(cursor, span.start) });
    }
    parts.push({
      type: "quote",
      key: `q-${span.draftId}-${i}`,
      draftId: span.draftId,
      value: text.slice(span.start, span.end),
    });
    cursor = span.end;
  });
  if (cursor < text.length) {
    parts.push({ type: "text", key: `t-${cursor}`, value: text.slice(cursor) });
  }
  return parts;
}
