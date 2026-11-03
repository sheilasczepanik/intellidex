import { LOUISIANA_ALERT_FEEDS, sampleNewsItems, type NewsTriageItem, type NewsTriageResponse } from "../src/lib/newsTriage.ts";

const DIRECT_TIMEOUT_MS = 8_000;
const PROXY_TIMEOUT_MS = 10_000;
const PER_FEED = 8;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const lastGoodItems = new Map<string, NewsTriageItem[]>();

const OUTLETS: Record<string, string> = {
  "theadvocate.com": "The Advocate",
  "theadvertiser.com": "The Advertiser",
  "nola.com": "NOLA.com",
  "acadiananewsfirst.com": "KATC",
  "katc.com": "KATC",
  "fox8live.com": "FOX 8",
  "wwltv.com": "WWL",
  "houmatoday.com": "Houma Today",
  "shreveporttimes.com": "The Times",
  "louisianaweekly.com": "The Louisiana Weekly",
};

function decodeXml(raw: string) {
  let text = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text
      .replace(/&amp;/gi, "&")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&middot;/gi, "·")
      .replace(/&ndash;/gi, "–")
      .replace(/&mdash;/gi, "—")
      .replace(/&hellip;/gi, "…")
      .replace(/&rsquo;|&lsquo;/gi, "'")
      .replace(/&rdquo;|&ldquo;/gi, '"')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/<\/?(?:b|strong|em|i|u|span)\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function outletName(link: string) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "").toLowerCase();
    if (OUTLETS[host]) return OUTLETS[host];
    const stem = host.split(".")[0] || host;
    if (/^[a-z]{2,6}\d{0,2}$/i.test(stem)) return stem.toUpperCase();
    return host;
  } catch {
    return "";
  }
}

function cleanSnippet(raw: string) {
  const text = decodeXml(raw).replace(/\bDNA used\b[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
  const chunks = text.split(/\s+·\s+/).map((part) => part.trim()).filter(Boolean);
  if (chunks.length > 1) {
    const prose = chunks.filter((part) => part.split(/\s+/).length >= 8);
    if (prose.length) return prose.join(" ").slice(0, 360);
    const longest = [...chunks].sort((a, b) => b.length - a.length)[0];
    if (longest) return longest.slice(0, 360);
  }
  return text.slice(0, 360);
}

function firstTag(block: string, names: string[]) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
    if (match?.[1]?.trim()) return match[1];
    const href = new RegExp(`<${name}\\b[^>]*href=["']([^"']+)["']`, "i").exec(block);
    if (href?.[1]) return href[1];
  }
  return "";
}

function stableId(link: string) {
  let hash = 0;
  for (const char of link) hash = Math.imul(hash, 31) + char.charCodeAt(0) | 0;
  return `news-${(hash >>> 0).toString(16)}`;
}

function publisherLink(raw: string) {
  const link = decodeXml(raw).replace(/&amp;/g, "&");
  try {
    const parsed = new URL(link);
    if (parsed.hostname === "www.google.com" && parsed.pathname === "/url") {
      const target = parsed.searchParams.get("url");
      if (target && /^https?:\/\//i.test(target)) return target;
    }
  } catch {
    return link;
  }
  return link;
}

function publishedIso(raw: string, fallback: string) {
  const trimmed = raw.trim().replace(" ", "T");
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function toItem(input: { title: string; link: string; source: string; snippet: string; published: string }, query: string, ingestedAt: string): NewsTriageItem | null {
  const titleRaw = decodeXml(input.title);
  const link = publisherLink(input.link);
  if (!titleRaw || !/^https?:\/\//i.test(link)) return null;
  const split = titleRaw.lastIndexOf(" - ");
  const title = split > 0 ? titleRaw.slice(0, split).trim() : titleRaw;
  const named = decodeXml(input.source);
  const fromTitle = split > 0 ? titleRaw.slice(split + 3).trim() : "";
  const source = (named && !/^google alert$/i.test(named) ? named : "") || fromTitle || outletName(link) || "Google Alert";
  return {
    id: stableId(link),
    query,
    title,
    link,
    source,
    snippet: cleanSnippet(input.snippet),
    publishedAt: publishedIso(input.published, ingestedAt),
    ingestedAt,
    status: "new",
    sample: false,
  };
}

export function allowedNewsFeed(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname === "news.google.com" && parsed.pathname.startsWith("/rss/")) return true;
    if (parsed.hostname === "www.google.com" && parsed.pathname.startsWith("/alerts/feeds/")) return true;
    return false;
  } catch {
    return false;
  }
}

function parseItems(xml: string, query: string, ingestedAt: string): NewsTriageItem[] {
  return xml.split(/<(?:item|entry)\b/i).slice(1).slice(0, PER_FEED).flatMap((block) => {
    const item = toItem({
      title: firstTag(block, ["title"]),
      link: firstTag(block, ["link"]),
      source: firstTag(block, ["source", "name"]),
      snippet: firstTag(block, ["description", "content", "summary"]),
      published: firstTag(block, ["pubDate", "published", "updated", "dc:date"]),
    }, query, ingestedAt);
    return item ? [item] : [];
  });
}

async function fetchText(url: string, timeout: number, accept: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA, Accept: accept },
    });
    const text = await res.text();
    return { ok: res.ok, text };
  } catch {
    return { ok: false, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function pullViaRss2Json(url: string, query: string, ingestedAt: string) {
  const endpoint = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`;
  const res = await fetchText(endpoint, PROXY_TIMEOUT_MS, "application/json");
  if (!res.ok || !res.text) return null;
  try {
    const json = JSON.parse(res.text) as { status?: string; items?: { title?: string; link?: string; pubDate?: string; description?: string; author?: string }[] };
    if (json.status !== "ok" || !Array.isArray(json.items)) return null;
    return json.items.slice(0, PER_FEED).flatMap((row) => {
      const item = toItem({
        title: row.title || "",
        link: row.link || "",
        source: row.author || "",
        snippet: row.description || "",
        published: row.pubDate || "",
      }, query, ingestedAt);
      return item ? [item] : [];
    });
  } catch {
    return null;
  }
}

async function pullFeed(url: string, query: string, ingestedAt: string) {
  const direct = await fetchText(url, DIRECT_TIMEOUT_MS, "application/atom+xml, application/rss+xml, application/xml, text/xml");
  if (direct.ok && /<(feed|rss)\b/i.test(direct.text)) {
    const items = parseItems(direct.text, query, ingestedAt);
    const declared = (direct.text.match(/<(?:item|entry)\b/gi) || []).length;
    if (items.length || declared === 0) return { query, ok: true, items };
  }
  const proxied = await pullViaRss2Json(url, query, ingestedAt);
  if (proxied) return { query, ok: true, items: proxied };
  return { query, ok: false, items: [] as NewsTriageItem[] };
}

function sampleFor(query: string, ingestedAt: string) {
  return sampleNewsItems(ingestedAt).find((item) => item.query === query) ?? null;
}

export async function getNewsTriage(customFeeds: string[]): Promise<NewsTriageResponse> {
  const ingestedAt = new Date().toISOString();
  const jobs: { url: string; query: string }[] = LOUISIANA_ALERT_FEEDS.map((feed) => ({ url: feed.url, query: feed.query }));
  for (const feed of customFeeds) {
    const url = feed.trim();
    if (!allowedNewsFeed(url)) continue;
    jobs.push({ url, query: "Custom Google Alert" });
  }
  const results = await Promise.all(jobs.map((job) => pullFeed(job.url, job.query, ingestedAt)));
  const seen = new Set<string>();
  const items: NewsTriageItem[] = [];
  for (const result of results) {
    const live = result.ok ? result.items : (lastGoodItems.get(result.query) ?? []);
    if (result.ok && result.items.length) lastGoodItems.set(result.query, result.items);
    const chosen = live.length ? live : [sampleFor(result.query, ingestedAt)].filter((item): item is NewsTriageItem => Boolean(item));
    for (const item of chosen) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      items.push(item);
    }
  }
  const queries = results.map((result) => ({ query: result.query, ok: result.ok, count: result.items.length }));
  const anyLive = items.some((item) => !item.sample);
  return {
    items,
    fetchedAt: ingestedAt,
    offline: !anyLive,
    queries,
  };
}
