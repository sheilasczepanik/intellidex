export const PRESS_SOURCE_TYPE = "External Press / Secondary Intelligence";

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
  domain?: string;
  sourceType?: string;
  summary?: string;
};

export function parseArticleUrl(raw: string): string | null {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
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

export function fallbackArticleFromUrl(url: string): ScrapedArticle {
  const parsed = parseArticleUrl(url) || url.trim();
  let href = parsed;
  let domain = "";
  try {
    const u = new URL(parsed);
    href = u.toString();
    domain = u.hostname.replace(/^www\./i, "");
  } catch {
    domain = parsed.replace(/^https?:\/\//i, "").split("/")[0] || "";
  }
  let title = titleFromUrlSlug(href);
  try {
    const u = new URL(href);
    const namusToken = u.href.match(/\b(?:NamUs[#\- ]?\d+|MP[#\- ]?\d{2,})\b/i);
    const namusPath = u.pathname.match(/\/(?:case|missingpersons?|mp)[/-]?(\d+)/i);
    if (/namus/i.test(u.hostname) && (namusToken || namusPath)) {
      title = `NamUs Case ${namusPath?.[1] || namusToken?.[0] || domain}`;
    }
  } catch {
    /* keep slug title */
  }
  const summary = `External news report referenced from ${href}`;
  return {
    url: href,
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

export async function scrapeArticleFromUrl(url: string): Promise<ScrapedArticle> {
  const fallback = fallbackArticleFromUrl(url);
  try {
    const res = await fetch("/api/scrape-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(8000),
    });
    const rawText = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      return fallback;
    }
    if (!res.ok) return fallback;
    const content = typeof json.content === "string" && json.content.trim()
      ? json.content
      : (typeof json.summary === "string" && json.summary.trim() ? json.summary : fallback.content);
    const title = typeof json.title === "string" && json.title.trim() ? json.title : fallback.title;
    const domain = typeof json.domain === "string" && json.domain.trim() ? json.domain : fallback.domain;
    return {
      url: typeof json.url === "string" && json.url.trim() ? json.url : fallback.url,
      title,
      publishedDate: typeof json.publishedDate === "string" && json.publishedDate.trim() ? json.publishedDate : null,
      content,
      wordCount: typeof json.wordCount === "number" ? json.wordCount : content.split(/\s+/).filter(Boolean).length,
      domain,
      sourceType: typeof json.sourceType === "string" && json.sourceType.trim() ? json.sourceType : PRESS_SOURCE_TYPE,
      summary: typeof json.summary === "string" && json.summary.trim() ? json.summary : fallback.summary,
      fallback: Boolean(json.fallback) || content === fallback.content,
    };
  } catch {
    return fallback;
  }
}

export function fallbackPageMetadata(url: string): PageMetadata {
  const article = fallbackArticleFromUrl(url);
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

export async function parseMetadataFromUrl(url: string): Promise<PageMetadata> {
  const fallback = fallbackPageMetadata(url);
  try {
    const res = await fetch("/api/parseMetadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const rawText = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      return fallback;
    }
    if (!res.ok) return fallback;
    const parsed = parseArticleUrl(url) || url;
    return {
      url: typeof json.url === "string" && json.url.trim() ? json.url : parsed,
      title: typeof json.title === "string" && json.title.trim() ? json.title : fallback.title,
      description: typeof json.description === "string" ? json.description : fallback.description,
      author: typeof json.author === "string" ? json.author : "",
      favicon: typeof json.favicon === "string" ? json.favicon : "",
      image: typeof json.image === "string" ? json.image : "",
      publishedDate: typeof json.publishedDate === "string" && json.publishedDate.trim() ? json.publishedDate : null,
      domain: typeof json.domain === "string" ? json.domain : fallback.domain,
      sourceType: typeof json.sourceType === "string" ? json.sourceType : fallback.sourceType,
      summary: typeof json.summary === "string" ? json.summary : fallback.summary,
    };
  } catch {
    return fallback;
  }
}
