export type ScrapedArticle = {
  url: string;
  title: string;
  publishedDate: string | null;
  content: string;
  wordCount: number;
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

export async function scrapeArticleFromUrl(url: string): Promise<ScrapedArticle> {
  const res = await fetch("/api/scrape-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = typeof json.error === "string" && json.error.trim()
      ? json.error
      : (rawText.replace(/\s+/g, " ").trim().slice(0, 400) || `Scrape failed (${res.status})`);
    throw new Error(err);
  }
  const content = typeof json.content === "string" ? json.content : "";
  if (!content.trim()) {
    throw new Error("Unable to scrape article directly. Please paste article copy into 'Paste narrative' below.");
  }
  return {
    url: typeof json.url === "string" ? json.url : url,
    title: typeof json.title === "string" && json.title.trim() ? json.title : "Untitled article",
    publishedDate: typeof json.publishedDate === "string" && json.publishedDate.trim() ? json.publishedDate : null,
    content,
    wordCount: typeof json.wordCount === "number" ? json.wordCount : content.split(/\s+/).filter(Boolean).length,
  };
}
