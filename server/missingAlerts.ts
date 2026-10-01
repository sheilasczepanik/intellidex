import { assertPublicHttpUrl, ScrapeHttpError } from "./scrapeUrl.ts";
import {
  classifyLiveAlertType,
  FALLBACK_MISSING_ALERTS,
  type LiveMissingAlert,
  type MissingAlertSourceStatus,
  type MissingAlertsResponse,
} from "../src/lib/liveMissingAlert.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NCMEC_INDEX = "https://www.missingkids.org/gethelpnow/search/rss";
const NCMEC_NATIONAL =
  "https://api.missingkids.org/missingkids/servlet/XmlServlet?act=rss&LanguageCountry=en_US&orgPrefix=NCMC";
const NCMEC_STATE =
  "https://api.missingkids.org/missingkids/servlet/XmlServlet?act=rss&LanguageCountry=en_US&orgPrefix=NCMC&state=";

const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_ALERTS = 48;
const STATE_RE = /^[A-Z]{2}$/;

type CacheEntry = { expires: number; body: MissingAlertsResponse };

const cache = new Map<string, CacheEntry>();
const lastGoodLive = new Map<string, MissingAlertsResponse>();

function decodeXml(raw: string) {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function tagContents(xml: string, name: string) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function firstTag(xml: string, names: string[]) {
  for (const name of names) {
    const hit = tagContents(xml, name)[0];
    if (hit != null && hit.trim()) return hit;
  }
  return "";
}

function attr(fragment: string, name: string) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return re.exec(fragment)?.[1] || "";
}

function selfClosing(xml: string, name: string) {
  const re = new RegExp(`<${name}\\b([^>]*)\\/?>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] || "");
  return out;
}

function upgradeHttps(url: string) {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === "http:" && /\.missingkids\.org$/i.test(parsed.hostname)) {
      parsed.protocol = "https:";
    }
    if (parsed.hostname === "www.missingkids.com") parsed.hostname = "www.missingkids.org";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function resolveNcmecHref(href: string, base: string) {
  const trimmed = href.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/missingkids/")) return `https://api.missingkids.org${trimmed}`;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return "";
  }
}

function toIso(raw: string) {
  const ms = Date.parse(raw.trim());
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return "";
}

function parseTitleName(title: string) {
  const cleaned = decodeXml(title).replace(/^[\s:·•-]+/, "").trim();
  const loc = cleaned.match(/\(([^)]+)\)\s*$/);
  const name = (loc ? cleaned.slice(0, loc.index) : cleaned).replace(/[,:]+$/, "").trim();
  return { name: name || "Unknown subject", locationHint: loc?.[1]?.trim() || "" };
}

function parseAge(text: string) {
  const now = text.match(/Age\s*Now:\s*([^.,;\n]+)/i) || text.match(/\bAge[:\s]+(\d{1,3})\b/i);
  const value = (now?.[1] || "").replace(/years?|yrs?\.?/gi, "").trim();
  return value || undefined;
}

function parseLocation(text: string, fallback: string) {
  const from = text.match(/Missing\s+From\s+([^.\n]+)/i);
  const area = text.match(/areaDesc[:\s]+([^.\n]+)/i);
  const raw = decodeXml(from?.[1] || area?.[1] || fallback || "").replace(/\s+/g, " ").trim();
  return raw || "Location not stated";
}

function enclosureUrl(block: string) {
  for (const attrs of selfClosing(block, "enclosure")) {
    const url = attr(attrs, "url");
    const type = attr(attrs, "type").toLowerCase();
    if (url && (!type || type.startsWith("image/"))) return upgradeHttps(url);
  }
  const media = attr(block, "url");
  if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(media)) return upgradeHttps(media);
  const img = block.match(/<img\b[^>]*src=["']([^"']+)["']/i);
  if (img?.[1]) return upgradeHttps(decodeXml(img[1]));
  return "";
}

function atomLink(block: string) {
  const links = selfClosing(block, "link");
  let fallback = "";
  for (const attrs of links) {
    const href = attr(attrs, "href");
    const rel = attr(attrs, "rel").toLowerCase();
    if (!href) continue;
    if (!rel || rel === "alternate") return upgradeHttps(href);
    if (!fallback) fallback = href;
  }
  const nested = firstTag(block, ["link"]);
  if (nested && /^https?:/i.test(nested.trim())) return upgradeHttps(nested.trim());
  return fallback ? upgradeHttps(fallback) : "";
}

function hashId(parts: string[]) {
  const raw = parts.filter(Boolean).join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `alert-${(h >>> 0).toString(16)}`;
}

function toAlert(block: string, channelTitle: string): LiveMissingAlert | null {
  const titleRaw = firstTag(block, ["title", "headline", "event"]);
  const descRaw = firstTag(block, ["description", "summary", "content", "instruction"]);
  const title = decodeXml(titleRaw);
  const summary = decodeXml(descRaw) || title;
  if (!title && !summary) return null;

  const { name, locationHint } = parseTitleName(title || summary.split(/[.\n]/)[0] || "Unknown subject");
  const guid = decodeXml(firstTag(block, ["guid", "id", "identifier"]));
  const link = upgradeHttps(
    decodeXml(firstTag(block, ["link", "web"])) || atomLink(block) || "",
  );
  const timestamp =
    toIso(decodeXml(firstTag(block, ["pubDate", "updated", "published", "sent", "effective", "dc:date"]))) ||
    new Date().toISOString();
  const photo = enclosureUrl(block) || undefined;
  const blob = `${channelTitle} ${title} ${summary}`;
  const location = parseLocation(summary, locationHint);
  const age = parseAge(summary) || parseAge(title);
  const externalUrl = link || (guid.startsWith("http") ? upgradeHttps(guid) : NCMEC_INDEX);
  const id = guid || hashId([name, location, timestamp, externalUrl]);

  return {
    id,
    name,
    ...(age ? { age } : {}),
    alertType: classifyLiveAlertType(blob),
    location,
    timestamp,
    summary: summary.slice(0, 1200),
    ...(photo ? { photoUrl: photo } : {}),
    externalUrl,
  };
}

function parseFeedXml(xml: string): { title: string; alerts: LiveMissingAlert[] } {
  const channelTitle = decodeXml(firstTag(xml, ["title"])) || "Missing person feed";
  const alerts: LiveMissingAlert[] = [];
  const blocks = [
    ...tagContents(xml, "item"),
    ...tagContents(xml, "entry"),
    ...tagContents(xml, "alert"),
  ];
  for (const block of blocks) {
    try {
      const alert = toAlert(block, channelTitle);
      if (alert) alerts.push(alert);
    } catch (err) {
      console.error("[alerts] Skipped a malformed feed item", err);
    }
  }
  return { title: channelTitle, alerts };
}

function tryParseFeedXml(xml: string): { title: string; alerts: LiveMissingAlert[] } {
  try {
    if (!xml || !/<rss[\s>]|<feed[\s>]|<alert[\s>]|<item[\s>]|<entry[\s>]/i.test(xml)) {
      throw new Error("Response was not RSS/Atom/CAP XML.");
    }
    return parseFeedXml(xml);
  } catch (err) {
    console.error("[alerts] XML parse failed", err);
    return { title: "", alerts: [] };
  }
}

function discoverNcmecFeeds(html: string) {
  const hrefs: string[] = [];
  const re = /href="(\/missingkids\/servlet\/XmlServlet[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = resolveNcmecHref(m[1].replace(/&amp;/g, "&"), NCMEC_INDEX);
    if (url && !url.includes("&state=")) hrefs.push(url);
  }
  return [...new Set(hrefs)];
}

function fetchSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const ac = new AbortController();
  setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  return ac.signal;
}

async function fetchText(url: string) {
  const parsed = assertPublicHttpUrl(url);
  try {
    const res = await fetch(parsed.toString(), {
      signal: fetchSignal(),
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": BROWSER_UA,
      },
      redirect: "follow",
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[alerts] NCMEC fetch HTTP ${res.status} for ${parsed.toString()}`);
      throw new ScrapeHttpError(res.status, `Feed returned HTTP ${res.status}`);
    }
    return { url: parsed.toString(), text, contentType: res.headers.get("content-type") || "" };
  } catch (err) {
    if (err instanceof ScrapeHttpError) throw err;
    const message = err instanceof Error ? err.message : "Feed fetch failed.";
    console.error("[alerts] NCMEC fetch failed", message);
    throw new ScrapeHttpError(502, message);
  }
}

function extraFeedsFromEnv(env: Record<string, string | undefined>) {
  const raw = env.MISSING_ALERT_FEEDS || "";
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function feedUrlsForRequest(opts: { state?: string; env: Record<string, string | undefined> }) {
  const urls = [NCMEC_NATIONAL, ...extraFeedsFromEnv(opts.env)];
  const state = (opts.state || "").trim().toUpperCase();
  if (STATE_RE.test(state)) urls.push(`${NCMEC_STATE}${state}`);
  return [...new Set(urls)];
}

async function loadOneFeed(url: string): Promise<{ source: MissingAlertSourceStatus; alerts: LiveMissingAlert[] }> {
  try {
    const page = await fetchText(url);
    const looksHtml = /text\/html/i.test(page.contentType) || /<html[\s>]/i.test(page.text.slice(0, 800));
    if (looksHtml && !/<rss[\s>]|<feed[\s>]|<alert[\s>]/i.test(page.text)) {
      const discovered = discoverNcmecFeeds(page.text);
      const national = discovered[0] || NCMEC_NATIONAL;
      const nested = await fetchText(national);
      const parsed = tryParseFeedXml(nested.text);
      return {
        source: { url: national, title: parsed.title, ok: parsed.alerts.length > 0, itemCount: parsed.alerts.length },
        alerts: parsed.alerts,
      };
    }
    const parsed = tryParseFeedXml(page.text);
    if (!parsed.alerts.length) {
      console.error("[alerts] Parsed zero items from", page.url);
      return {
        source: { url: page.url, ok: false, error: "NCMEC feed temporarily unreachable" },
        alerts: [],
      };
    }
    return {
      source: { url: page.url, title: parsed.title, ok: true, itemCount: parsed.alerts.length },
      alerts: parsed.alerts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load feed.";
    console.error("[alerts] Feed load failed", url, message);
    return { source: { url, ok: false, error: message }, alerts: [] };
  }
}

function mergeAlerts(lists: LiveMissingAlert[][]) {
  const seen = new Set<string>();
  const out: LiveMissingAlert[] = [];
  for (const list of lists) {
    for (const alert of list) {
      const key = `${alert.id}|${alert.name.toLowerCase()}|${alert.location.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(alert);
    }
  }
  out.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return out.slice(0, MAX_ALERTS);
}

function offlineBody(
  cacheKey: string,
  sources: MissingAlertSourceStatus[],
): MissingAlertsResponse {
  const prior = lastGoodLive.get(cacheKey);
  const warning = "NCMEC feed temporarily unreachable";
  if (prior?.alerts.length) {
    return {
      ...prior,
      cached: true,
      offline: true,
      warning,
      sources: sources.length ? sources : prior.sources,
    };
  }
  return {
    alerts: FALLBACK_MISSING_ALERTS,
    fetchedAt: new Date().toISOString(),
    cached: true,
    offline: true,
    sources,
    warning,
  };
}

export async function getMissingAlerts(opts: {
  state?: string;
  env?: Record<string, string | undefined>;
  bypassCache?: boolean;
}): Promise<MissingAlertsResponse> {
  try {
    const env = opts.env || process.env;
    const urls = feedUrlsForRequest({ state: opts.state, env });
    const cacheKey = urls.join("|");
    const hit = cache.get(cacheKey);
    if (!opts.bypassCache && hit && hit.expires > Date.now()) {
      return { ...hit.body, cached: true };
    }

    const results = await Promise.all(urls.map((url) => loadOneFeed(url)));
    const alerts = mergeAlerts(results.map((r) => r.alerts));
    const sources = results.map((r) => r.source);
    const failed = sources.filter((s) => !s.ok);

    if (!alerts.length) {
      const body = offlineBody(cacheKey, sources);
      cache.set(cacheKey, { expires: Date.now() + 60_000, body });
      return body;
    }

    const warning = failed.length
      ? `Some feeds were unavailable (${failed.length}). Showing ${alerts.length} live items.`
      : undefined;

    const body: MissingAlertsResponse = {
      alerts,
      fetchedAt: new Date().toISOString(),
      cached: false,
      offline: false,
      sources,
      ...(warning ? { warning } : {}),
    };
    cache.set(cacheKey, { expires: Date.now() + CACHE_MS, body });
    lastGoodLive.set(cacheKey, body);
    return body;
  } catch (err) {
    console.error("[alerts] getMissingAlerts failed", err);
    const env = opts.env || process.env;
    const urls = feedUrlsForRequest({ state: opts.state, env });
    return offlineBody(urls.join("|"), []);
  }
}
