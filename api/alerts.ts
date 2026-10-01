import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMissingAlerts } from "../server/missingAlerts.ts";
import { FALLBACK_MISSING_ALERTS } from "../src/lib/liveMissingAlert.ts";

export const maxDuration = 30;

export const config = {
  maxDuration: 30,
};

function ok(res: VercelResponse, body: unknown) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=60");
  return res.status(200).json(body);
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return ok(res, { error: "GET only", alerts: [], fetchedAt: new Date().toISOString(), cached: true, offline: true, sources: [] });
  }

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
    return ok(res, body);
  } catch (err: unknown) {
    console.error("[alerts] handler failed", err);
    return ok(res, {
      alerts: FALLBACK_MISSING_ALERTS,
      fetchedAt: new Date().toISOString(),
      cached: true,
      offline: true,
      sources: [],
      warning: "NCMEC feed temporarily unreachable",
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleGet(req, res);
}
