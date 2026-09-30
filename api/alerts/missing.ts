import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMissingAlerts } from "../../server/missingAlerts.ts";

export const maxDuration = 30;

export const config = {
  maxDuration: 30,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=60");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const stateRaw = req.query?.state;
    const state = Array.isArray(stateRaw) ? stateRaw[0] : stateRaw;
    const refreshRaw = req.query?.refresh;
    const refresh = Array.isArray(refreshRaw) ? refreshRaw[0] : refreshRaw;
    const body = await getMissingAlerts({
      state: typeof state === "string" ? state : "",
      env: process.env,
      bypassCache: refresh === "1" || refresh === "true",
    });
    return res.status(200).json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Alert feed failed.";
    return res.status(200).json({
      alerts: [],
      fetchedAt: new Date().toISOString(),
      cached: false,
      sources: [],
      warning: message,
    });
  }
}
