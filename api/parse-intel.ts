import type { VercelRequest, VercelResponse } from "@vercel/node";
import { IntelParseError, parseIntelWithAnthropic } from "../server/parseIntel.ts";

export const maxDuration = 60;

export const config = {
  maxDuration: 60,
};

function header(req: VercelRequest, name: string) {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
}

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
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-dossier-key, x-dossier-provider");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = header(req, "x-dossier-key").trim() || process.env.ANTHROPIC_API_KEY || "";
    if (!apiKey) {
      return res.status(500).json({
        error: "Server configuration error: ANTHROPIC_API_KEY is not set in Vercel environment variables.",
      });
    }
    const payload = parseBody(req.body);
    const text = typeof payload.text === "string" ? payload.text : typeof payload.rawContent === "string" ? payload.rawContent : "";
    if (text.trim().length < 12) {
      return res.status(400).json({ error: "Raw intel / tip transcript is empty or too short." });
    }
    const claims = await parseIntelWithAnthropic(apiKey, text);
    return res.status(200).json({ claims });
  } catch (err: unknown) {
    console.error("Unhandled intel parse failure:", err);
    const status = err instanceof IntelParseError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal server error during intel parse";
    return res.status(status).json({ error: message });
  }
}
