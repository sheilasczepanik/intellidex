import type { CaseRecord, NewsTriageItem } from "../db/schema";

export type { NewsTriageItem };

export const LOUISIANA_ALERT_FEEDS = [
  {
    query: "Louisiana missing person",
    url: "https://www.google.com/alerts/feeds/14801168394638114600/2101019157095713831",
  },
  {
    query: "Louisiana remains found",
    url: "https://www.google.com/alerts/feeds/14801168394638114600/2101019157095714660",
  },
  {
    query: "Louisiana body found",
    url: "https://www.google.com/alerts/feeds/14801168394638114600/5310712761515719825",
  },
] as const;

export const LOUISIANA_ALERT_QUERIES = LOUISIANA_ALERT_FEEDS.map((feed) => feed.query);

export type NewsTriageResponse = {
  items: NewsTriageItem[];
  fetchedAt: string;
  offline: boolean;
  warning?: string;
  queries: { query: string; ok: boolean; count: number }[];
};

const FEED_KEY = "dossier.googleAlertFeeds";

export function loadCustomAlertFeeds() {
  try {
    const raw = localStorage.getItem(FEED_KEY) || "";
    return raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveCustomAlertFeeds(feeds: string[]) {
  const clean = feeds.map((line) => line.trim()).filter(Boolean);
  if (clean.length) localStorage.setItem(FEED_KEY, clean.join("\n"));
  else localStorage.removeItem(FEED_KEY);
  return clean;
}

export function isGoogleAlertFeed(url: string) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:"
      && parsed.hostname === "www.google.com"
      && parsed.pathname.startsWith("/alerts/feeds/");
  } catch {
    return false;
  }
}

export function sampleNewsItems(now = new Date().toISOString()): NewsTriageItem[] {
  return LOUISIANA_ALERT_QUERIES.map((query, index) => ({
    id: `sample-la-${index + 1}`,
    query,
    title: sampleTitle(query),
    link: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
    source: "Cached sample",
    snippet: "Cached sample for this alert query. A live Google Alert headline replaces it when the feed has a new story.",
    publishedAt: now,
    ingestedAt: now,
    status: "new",
    sample: true,
  }));
}

function sampleTitle(query: string) {
  if (query.includes("remains")) return "Louisiana search teams examine remains reported near a parish waterway";
  if (query.includes("body")) return "Authorities respond after a body is reported in rural Louisiana";
  return "Louisiana parish continues a search for a missing adult";
}

export function matchNewsToCases(item: NewsTriageItem, cases: CaseRecord[]) {
  const hay = `${item.title} ${item.snippet}`.toLowerCase();
  return cases.filter((row) => {
    const name = (row.subjectName || row.title || "").trim().toLowerCase();
    if (name.length >= 5 && hay.includes(name)) return true;
    const doe = (row.doeNetworkId || "").trim().toLowerCase();
    if (doe.length >= 6 && hay.includes(doe)) return true;
    const file = (row.fileIdentifier || "").trim().toLowerCase();
    if (file.length >= 4 && hay.includes(file)) return true;
    return false;
  });
}

function sampleResponse(): NewsTriageResponse {
  return {
    items: sampleNewsItems(),
    fetchedAt: new Date().toISOString(),
    offline: true,
    queries: [],
  };
}

export async function fetchNewsTriage(feeds: string[]): Promise<NewsTriageResponse> {
  try {
    const res = await fetch("/api/news-rss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds }),
    });
    if (!res.ok) return sampleResponse();
    const json = await res.json() as Partial<NewsTriageResponse>;
    const items = Array.isArray(json.items) ? json.items.filter((item) => item && item.title && item.link) : [];
    if (!items.length) return sampleResponse();
    return {
      items,
      fetchedAt: typeof json.fetchedAt === "string" ? json.fetchedAt : new Date().toISOString(),
      offline: Boolean(json.offline),
      warning: typeof json.warning === "string" ? json.warning : undefined,
      queries: Array.isArray(json.queries) ? json.queries : [],
    };
  } catch {
    return sampleResponse();
  }
}
