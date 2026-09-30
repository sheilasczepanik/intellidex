export const SCRAPE_BLOCKED =
  "Unable to scrape article directly. Please paste article copy into 'Paste narrative' below.";

export type ScrapedArticle = {
  url: string;
  title: string;
  publishedDate: string | null;
  content: string;
  wordCount: number;
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

export function assertPublicHttpUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ScrapeHttpError(400, "Enter a valid http:// or https:// URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ScrapeHttpError(400, "Enter a valid http:// or https:// URL.");
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new ScrapeHttpError(400, "That URL cannot be fetched from the scrape service.");
  }
  return parsed;
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

export async function scrapePublicArticle(rawUrl: string): Promise<ScrapedArticle> {
  const parsed = assertPublicHttpUrl(rawUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    throw new ScrapeHttpError(422, SCRAPE_BLOCKED);
  } finally {
    clearTimeout(timer);
  }

  const html = await res.text();
  if (!res.ok || looksBlocked(res.status, html)) {
    throw new ScrapeHttpError(422, SCRAPE_BLOCKED);
  }

  const finalUrl = res.url || parsed.toString();
  try {
    assertPublicHttpUrl(finalUrl);
  } catch {
    throw new ScrapeHttpError(422, SCRAPE_BLOCKED);
  }

  const content = extractBody(html);
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length < 40) {
    throw new ScrapeHttpError(422, SCRAPE_BLOCKED);
  }

  return {
    url: finalUrl,
    title: extractTitle(html).slice(0, 240),
    publishedDate: extractDate(html),
    content,
    wordCount: words.length,
  };
}

export type PageMetadata = {
  url: string;
  title: string;
  description: string;
  author: string;
  favicon: string;
  image: string;
  publishedDate: string | null;
};

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
  const parsed = assertPublicHttpUrl(rawUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    return {
      url: parsed.toString(),
      title: parsed.hostname.replace(/^www\./, ""),
      description: "",
      author: "",
      favicon: new URL("/favicon.ico", parsed).toString(),
      image: "",
      publishedDate: null,
    };
  } finally {
    clearTimeout(timer);
  }
  const html = await res.text().catch(() => "");
  const finalUrl = res.url || parsed.toString();
  let base: URL;
  try {
    base = new URL(finalUrl);
  } catch {
    base = parsed;
  }
  const title = extractTitle(html).slice(0, 240) || base.hostname.replace(/^www\./, "");
  return {
    url: finalUrl,
    title,
    description: extractDescription(html).slice(0, 400),
    author: extractAuthor(html).slice(0, 160),
    favicon: extractFavicon(html, base),
    image: extractOgImage(html, base),
    publishedDate: extractDate(html),
  };
}
