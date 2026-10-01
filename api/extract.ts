import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dispatchExtract } from "../server/extract.ts";
import { readJsonBody } from "../server/readJsonBody.ts";
import { mauraFallbackApiBody } from "../src/lib/mauraExtractFallback.ts";

export const maxDuration = 60;

export const config = {
  maxDuration: 60,
};

function header(req: VercelRequest, name: string) {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-dossier-key, x-dossier-provider",
  );
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("[Extraction] OPENAI_API_KEY present:", Boolean((process.env.OPENAI_API_KEY || "").trim()));
    const payload = await readJsonBody(req);
    const result = await dispatchExtract({
      payload,
      headerKey: header(req, "x-dossier-key") || header(req, "x-api-key"),
      headerProvider: header(req, "x-dossier-provider"),
      env: process.env,
    });
    return res.status(200).json(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction service unavailable (verify API key or document size)";
    console.error("[Extraction] Endpoint error", message);
    return res.status(200).json(mauraFallbackApiBody());
  }
}
