import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fallbackPageMetadata, parsePageMetadata } from "../server/scrapeUrl.ts";

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
      const meta = await parsePageMetadata(url);
      return res.status(200).json(meta);
    } catch {
      return res.status(200).json(fallbackPageMetadata(url));
    }
  } catch {
    return res.status(200).json(fallbackPageMetadata(""));
  }
}
