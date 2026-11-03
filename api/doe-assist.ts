import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readJsonBody } from "../server/readJsonBody.ts";
import { assistDoeProfile } from "../server/doeAssist.ts";
import { resolveExtractEngine } from "../server/structuredExtract.ts";
import { doeRecordHasFacts, parseDoePaste } from "../src/lib/doeNetworkPaste.ts";

export const maxDuration = 30;

function header(req: VercelRequest, name: string) {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-dossier-key");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const payload = await readJsonBody(req);
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const url = typeof payload.url === "string" ? payload.url.trim() : "";
  if (!text) {
    return res.status(400).json({
      error: "Paste the Doe Network profile text. A URL alone is kept for reference and is not fetched.",
    });
  }
  try {
    const resolved = resolveExtractEngine({
      headerKey: header(req, "x-dossier-key") || header(req, "x-api-key"),
      env: process.env,
    });
    const result = await assistDoeProfile({ text, url, apiKey: resolved.apiKey, model: resolved.model });
    if (!doeRecordHasFacts(result.record)) {
      return res.status(200).json({ ...result, warning: "No demographic fields were found in that paste." });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("[doe-assist] endpoint failed", err);
    return res.status(200).json({ engine: "local", record: parseDoePaste(text, url) });
  }
}
