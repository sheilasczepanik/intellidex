import { LOUISIANA_ALERT_QUERIES, sampleNewsItems, type NewsTriageItem, type NewsTriageResponse } from "../src/lib/newsTriage.ts";

const FETCH_TIMEOUT_MS = 8_000;
const PER_FEED = 8;

function decodeXml(raw: string) {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function presetUrl(query: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

function parseItems(xml: string, query: string, ingestedAt: string): NewsTriageItem[] {
  return xml.split(/<item\b/i).slice(1).slice(0, PER_FEED).flatMap((block) => {
    const titleRaw = decodeXml(firstTag(block, ["title"]));
    const link = decodeXml(firstTag(block, ["link"])).replace(/&amp;/g, "&");
    if (!titleRaw || !link.startsWith("http")) return [];
    const split = titleRaw.lastIndexOf(" - ");
    const title = split > 0 ? titleRaw.slice(0, split).trim() : titleRaw;
    const source = decodeXml(firstTag(block, ["source"])) || (split > 0 ? titleRaw.slice(split + 3).trim() : "Google News");
    const publishedRaw = decodeXml(firstTag(block, ["pubDate", "published", "updated", "dc:date"]));
    const publishedMs = Date.parse(publishedRaw);
    const snippet = decodeXml(firstTag(block, ["description", "content", "summary"])).slice(0, 360);
    return [{
      id: stableId(link),
      query,
      title,
      link,
      source: source || "Google News",
      snippet,
      publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : ingestedAt,
      ingestedAt,
      status: "new" as const,
      sample: false,
    }];
  });
}

async function pullFeed(url: string, query: string, ingestedAt: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "INTELLIDEX-NewsTriage/1.0", Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!res.ok) return { query, ok: false, items: [] as NewsTriageItem[] };
    const xml = await res.text();
    const items = parseItems(xml, query, ingestedAt);
    return { query, ok: items.length > 0, items };
  } catch {
    return { query, ok: false, items: [] as NewsTriageItem[] };
  } finally {
    clearTimeout(timer);
  }
}

export async function getNewsTriage(customFeeds: string[]): Promise<NewsTriageResponse> {
  const ingestedAt = new Date().toISOString();
  const jobs: { url: string; query: string }[] = LOUISIANA_ALERT_QUERIES.map((query) => ({ url: presetUrl(query), query }));
  for (const feed of customFeeds) {
    const url = feed.trim();
    if (!allowedNewsFeed(url)) continue;
    jobs.push({ url, query: "Custom Google Alert" });
  }
  const results = await Promise.all(jobs.map((job) => pullFeed(job.url, job.query, ingestedAt)));
  const seen = new Set<string>();
  const items = results.flatMap((result) => result.items).filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
  const queries = results.map((result) => ({ query: result.query, ok: result.ok, count: result.items.length }));
  if (items.length === 0) {
    return {
      items: sampleNewsItems(ingestedAt),
      fetchedAt: ingestedAt,
      offline: true,
      warning: "Louisiana alert feeds are temporarily unreachable",
      queries,
    };
  }
  const failed = queries.filter((row) => !row.ok).length;
  return {
    items,
    fetchedAt: ingestedAt,
    offline: false,
    warning: failed ? `${failed} alert ${failed === 1 ? "feed" : "feeds"} did not respond` : undefined,
    queries,
  };
}
