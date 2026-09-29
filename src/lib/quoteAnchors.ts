export type QuoteSpan = {
  draftId: string;
  start: number;
  end: number;
};

export type QuoteSegment =
  | { type: "text"; key: string; value: string }
  | { type: "quote"; key: string; draftId: string; value: string };

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

/** Locate a card quote in source text, tolerant of PDF whitespace. */
export function locateSnippet(haystack: string, snippet: string): { start: number; end: number } | null {
  const needle = snippet.trim();
  if (needle.length < 8) return null;

  const hayLower = haystack.toLowerCase();
  const needleLower = needle.toLowerCase();
  const exact = hayLower.indexOf(needleLower);
  if (exact >= 0) return { start: exact, end: exact + needle.length };

  const h = compactWithMap(haystack);
  const n = compactWithMap(needle).out.trim();
  if (n.length < 8) return null;

  let idx = h.out.indexOf(n);
  let matched = n;
  if (idx < 0) {
    for (let len = Math.min(n.length, 96); len >= 16; len -= 4) {
      const head = n.slice(0, len);
      const found = h.out.indexOf(head);
      if (found >= 0) {
        idx = found;
        matched = head;
        break;
      }
    }
  }
  if (idx < 0 || h.map[idx] === undefined) return null;
  const last = idx + matched.length - 1;
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
  drafts: { id: string; snippet: string }[],
): QuoteSpan[] {
  const found: QuoteSpan[] = [];
  const ranked = [...drafts].sort((a, b) => b.snippet.trim().length - a.snippet.trim().length);
  for (const d of ranked) {
    const loc = locateSnippet(text, d.snippet);
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
