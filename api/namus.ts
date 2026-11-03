import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ingestNamus, lookupNamus } from "../server/namusLookup.ts";
import { resolveExtractEngine } from "../server/structuredExtract.ts";
import { readJsonBody } from "../server/readJsonBody.ts";

export const maxDuration = 30;

export const config = {
  maxDuration: 30,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, x-dossier-key");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(200).json({ success: false, error: "GET or POST" });

  try {
    if (req.method === "POST") {
      const payload = await readJsonBody(req);
      const query = [payload.url, payload.id, payload.query].find((item) => typeof item === "string") as string | undefined;
      const text = typeof payload.text === "string" ? payload.text : "";
      const headerKey = header(req, "x-dossier-key") || header(req, "x-api-key");
      const resolved = resolveExtractEngine({ headerKey, env: process.env });
      return res.status(200).json(await ingestNamus({ query, text, apiKey: resolved.apiKey, model: resolved.model }));
    }
    const raw = req.query?.id ?? req.query?.url ?? req.query?.q;
    const query = Array.isArray(raw) ? raw[0] : raw;
    return res.status(200).json(await lookupNamus(typeof query === "string" ? query : ""));
  } catch (err) {
    console.error("[namus] handler failed", err);
    return res.status(200).json({
      success: false,
      blocked: true,
      error: "NamUs did not return a readable profile. Paste the profile text to fill this case.",
    });
  }
}

function header(req: VercelRequest, name: string) {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
}
