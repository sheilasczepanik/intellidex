import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parsePageMetadata, ScrapeHttpError } from "../server/scrapeUrl.ts";

export const maxDuration = 30;

export const config = {
  maxDuration: 30,
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const payload = parseBody(req.body);
    const url = typeof payload.url === "string" ? payload.url : "";
    const meta = await parsePageMetadata(url);
    return res.status(200).json(meta);
  } catch (err: unknown) {
    const status = err instanceof ScrapeHttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Metadata parse failed.";
    return res.status(status).json({ error: message });
  }
}
