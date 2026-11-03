import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readJsonBody } from "../server/readJsonBody.ts";
import { getNewsTriage } from "../server/newsRss.ts";
import { sampleNewsItems } from "../src/lib/newsTriage.ts";

export const maxDuration = 30;

function feedsFrom(payload: Record<string, unknown>) {
  const raw = payload.feeds;
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string");
  if (typeof raw === "string") return raw.split(/\n+/);
  return [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  try {
    const payload = req.method === "POST" ? await readJsonBody(req) : {};
    const body = await getNewsTriage(feedsFrom(payload));
    return res.status(200).json(body);
  } catch (err) {
    console.error("[news-rss] failed", err);
    return res.status(200).json({
      items: sampleNewsItems(),
      fetchedAt: new Date().toISOString(),
      offline: true,
      queries: [],
    });
  }
}
