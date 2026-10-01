import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fallbackArticleFromUrl, scrapePublicArticle } from "../server/scrapeUrl.ts";

export const maxDuration = 10;

export const config = {
  maxDuration: 10,
};

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
    return {};
  }
  if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const payload = parseBody(req.body);
    const url = typeof payload.url === "string" ? payload.url : "";
    try {
      const article = await scrapePublicArticle(url);
      return res.status(200).json(article);
    } catch {
      return res.status(200).json(fallbackArticleFromUrl(url));
    }
  } catch {
    const url = typeof req.body === "object" && req.body && "url" in req.body ? String((req.body as { url?: string }).url || "") : "";
    return res.status(200).json(fallbackArticleFromUrl(url));
  }
}
