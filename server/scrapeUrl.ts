export const SCRAPE_BLOCKED =
  "Unable to scrape article directly. Please paste article copy into 'Paste narrative' below.";

export const PRESS_SOURCE_TYPE = "External Press / Secondary Intelligence";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_MS = 6000;
const MAX_HTML_BYTES = 800_000;

export type ScrapedArticle = {
  url: string;
  title: string;
  publishedDate: string | null;
  content: string;
  wordCount: number;
  domain: string;
  sourceType: string;
  summary: string;
  fallback?: boolean;
};

export type PageMetadata = {
  url: string;
  title: string;
  description: string;
  author: string;
  favicon: string;
  image: string;
  publishedDate: string | null;
  domain: string;
  sourceType: string;
  summary: string;
};

export class ScrapeHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ScrapeHttpError";
    this.status = status;
  }
}

function isPrivateHostname(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fe80:")) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function parsePublicHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (isPrivateHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function assertPublicHttpUrl(raw: string) {
  const parsed = parsePublicHttpUrl(raw);
  if (!parsed) throw new ScrapeHttpError(400, "Enter a valid http:// or https:// URL.");
  return parsed;
}

export function titleFromUrlSlug(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl.trim());
    const parts = parsed.pathname.split("/").filter(Boolean).map((part) => part.replace(/\.[a-z0-9]{1,8}$/i, ""));
    const slug = [...parts].reverse().find((part) => /[a-z]{3,}[-_][a-z]/i.test(part))
      || [...parts].reverse().find((part) => /[a-z]{4,}/i.test(part) && !/^\d+$/.test(part))
      || parts.at(-1)
      || "";
    const words = slug.replace(/[-_]+/g, " ").trim();
    if (words) {
      return words
        .split(/\s+/)
        .map((word) => {
          if (word.length <= 3) return word.toUpperCase();
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(" ");
    }
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return rawUrl.trim() || "External article";
  }
}

export function fallbackArticleFromUrl(rawUrl: string): ScrapedArticle {
  const trimmed = rawUrl.trim();
  let url = trimmed;
  let domain = "";
  try {
    const parsed = new URL(trimmed);
    url = parsed.toString();
    domain = parsed.hostname.replace(/^www\./i, "");
  } catch {
    domain = trimmed.replace(/^https?:\/\//i, "").split("/")[0] || "";
  }
  const title = titleFromUrlSlug(trimmed);
  const summary = `External news report referenced from ${url}`;
  return {
    url,
    title,
    publishedDate: null,
    content: summary,
    wordCount: summary.split(/\s+/).filter(Boolean).length,
    domain,
    sourceType: PRESS_SOURCE_TYPE,
    summary,
    fallback: true,
  };
}

export function fallbackPageMetadata(rawUrl: string): PageMetadata {
  const article = fallbackArticleFromUrl(rawUrl);
  return {
    url: article.url,
    title: article.title,
    description: article.summary,
    author: "",
    favicon: "",
    image: "",
    publishedDate: null,
    domain: article.domain,
    sourceType: article.sourceType,
    summary: article.summary,
  };
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(Number.parseInt(n, 16)));
}

function attrMatch(html: string, names: string[]) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["'][^>]*>`,
      "i",
    );
    const m = html.match(re);
    const value = (m?.[1] || m?.[2] || "").trim();
    if (value) return decodeEntities(value);
  }
  return "";
}

function looksBlocked(status: number, html: string) {
  if ([401, 403, 407, 429, 451].includes(status)) return true;
  const blob = html.slice(0, 12_000).toLowerCase();
  return (
    blob.includes("cf-browser-verification")
    || blob.includes("challenge-platform")
    || blob.includes("cdn-cgi/challenge")
    || blob.includes("attention required! | cloudflare")
    || blob.includes("just a moment...")
    || blob.includes("enable javascript and cookies to continue")
    || blob.includes("pardon our interruption")
    || blob.includes("subscribe to continue reading")
  );
}

function stripChrome(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ");
}

function htmlToText(html: string) {
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const og = attrMatch(html, ["og:title", "twitter:title"]);
  if (og) return og;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return decodeEntities(title.replace(/\s+/g, " ").trim()) || "Untitled article";
}

function extractDate(html: string) {
  const fromMeta = attrMatch(html, [
    "article:published_time",
    "og:published_time",
    "pubdate",
    "publish-date",
    "datePublished",
    "parsely-pub-date",
    "DC.date.issued",
    "date",
  ]);
  if (fromMeta) return fromMeta;
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  return time?.trim() || null;
}

function extractBody(html: string) {
  const cleaned = stripChrome(html);
  const article = cleaned.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  const main = cleaned.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  const role = cleaned.match(/<div[^>]+role=["']main["'][\s\S]*?<\/div>/i)?.[0];
  const chunk = article || main || role || cleaned;
  return htmlToText(chunk).slice(0, 100_000);
}

const READER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const DIRECT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const READER_MS = 8000;

function readerTitle(text: string) {
  const titled = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  if (titled && !/^https?:/i.test(titled)) return titled.replace(/^#+\s*/, "").slice(0, 240);
  const header = text.split("\n").map((line) => line.trim()).find((line) => /^#{1,3}\s+\S/.test(line));
  if (header) return header.replace(/^#+\s*/, "").slice(0, 240);
  const first = text.split("\n").map((line) => line.trim()).find(Boolean);
  return (first || "Imported Web Evidence").replace(/^#+\s*/, "").slice(0, 240);
}

function readerBody(text: string) {
  const marker = text.match(/Markdown Content:\s*/i);
  const body = marker && marker.index !== undefined
    ? text.slice(marker.index + marker[0].length).trim()
    : text.trim();
  return body || text.trim();
}

function readerUnusable(text: string) {
  const head = text.slice(0, 800).toLowerCase();
  if (head.includes("target url returned error") || head.includes("access denied")) return true;
  return text.trim().split(/\s+/).filter(Boolean).length < 40;
}

/** Read a public article as text. Reader proxy first; publisher HTML only if that fails. */
export async function scrapeArticleText(targetUrl: string): Promise<{ title: string; content: string; publishedDate: string | null }> {
  const parsed = assertPublicHttpUrl(targetUrl);
  const href = parsed.toString();
  try {
    const res = await fetch(`https://r.jina.ai/${href}`, {
      headers: {
        "User-Agent": READER_UA,
        Accept: "text/plain",
      },
      signal: AbortSignal.timeout(READER_MS),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.trim() && !readerUnusable(text)) {
        const content = readerBody(text);
        return { title: readerTitle(text), content, publishedDate: null };
      }
    }
  } catch (err) {
    console.warn("Reader proxy failed, attempting direct fetch:", err);
  }

  const directRes = await fetch(href, {
    redirect: "follow",
    headers: {
      "User-Agent": DIRECT_UA,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(READER_MS),
  });
  const html = await directRes.text().catch(() => "");
  if (!directRes.ok || !html || looksBlocked(directRes.status, html)) {
    throw new ScrapeHttpError(directRes.status || 502, SCRAPE_BLOCKED);
  }
  const snippet = html.slice(0, MAX_HTML_BYTES);
  const extracted = extractBody(snippet);
  const stripped = snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
  const content = extracted.split(/\s+/).filter(Boolean).length >= 40 ? extracted : stripped;
  return {
    title: extractTitle(snippet).slice(0, 240) || "Web Article",
    content,
    publishedDate: extractDate(snippet),
  };
}

export async function scrapePublicArticle(rawUrl: string): Promise<ScrapedArticle> {
  const fallback = fallbackArticleFromUrl(rawUrl);
  if (!parsePublicHttpUrl(rawUrl)) return fallback;

  try {
    const scraped = await scrapeArticleText(rawUrl);
    const words = scraped.content.split(/\s+/).filter(Boolean);
    let domain = fallback.domain;
    try {
      domain = new URL(fallback.url).hostname.replace(/^www\./i, "");
    } catch {
      /* keep fallback domain */
    }
    if (words.length < 40) {
      return {
        ...fallback,
        title: scraped.title || fallback.title,
        publishedDate: scraped.publishedDate,
        fallback: true,
      };
    }
    return {
      url: fallback.url,
      title: scraped.title || fallback.title,
      publishedDate: scraped.publishedDate,
      content: scraped.content,
      wordCount: words.length,
      domain,
      sourceType: PRESS_SOURCE_TYPE,
      summary: scraped.content.slice(0, 280),
    };
  } catch (err) {
    console.warn("Article scrape failed:", err);
    return fallback;
  }
}

function extractAuthor(html: string) {
  return attrMatch(html, ["article:author", "author", "og:article:author", "twitter:creator", "parsely-author"]) || "";
}

function extractDescription(html: string) {
  return attrMatch(html, ["og:description", "twitter:description", "description"]) || "";
}

function extractOgImage(html: string, base: URL) {
  const raw = attrMatch(html, ["og:image", "twitter:image", "twitter:image:src"]);
  if (!raw) return "";
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

function extractFavicon(html: string, base: URL) {
  const link = html.match(/<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*>/i)?.[0]
    || html.match(/<link[^>]+rel=["'](?:shortcut icon|icon)["'][^>]*>/i)?.[0]
    || "";
  const href = link.match(/href=["']([^"']+)["']/i)?.[1] || "";
  try {
    if (href) return new URL(href, base).toString();
  } catch {
    /* fall through */
  }
  return new URL("/favicon.ico", base).toString();
}

/** Lightweight metadata parse for Media Vault URL cards — does not require article body. */
export async function parsePageMetadata(rawUrl: string): Promise<PageMetadata> {
  const fallback = fallbackPageMetadata(rawUrl);
  const parsed = parsePublicHttpUrl(rawUrl);
  if (!parsed) return fallback;
  try {
    const res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_MS),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok || [403, 404, 408, 429].includes(res.status)) return fallback;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_HTML_BYTES) return fallback;
    const html = (await res.text().catch(() => "")).slice(0, MAX_HTML_BYTES);
    if (!html || looksBlocked(res.status, html)) return fallback;
    const finalUrl = res.url || parsed.toString();
    let base: URL;
    try {
      base = new URL(finalUrl);
    } catch {
      base = parsed;
    }
    const domain = base.hostname.replace(/^www\./i, "");
    const title = extractTitle(html).slice(0, 240) || titleFromUrlSlug(finalUrl);
    const description = extractDescription(html).slice(0, 400) || fallback.summary;
    return {
      url: finalUrl,
      title,
      description,
      author: extractAuthor(html).slice(0, 160),
      favicon: extractFavicon(html, base),
      image: extractOgImage(html, base),
      publishedDate: extractDate(html),
      domain,
      sourceType: PRESS_SOURCE_TYPE,
      summary: description,
    };
  } catch {
    return fallback;
  }
}
