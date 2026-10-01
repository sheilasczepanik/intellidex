import type { VercelRequest, VercelResponse } from "@vercel/node";
import { lookupNamus } from "../server/namusLookup.ts";
import { fallbackNamusRecord, namusNumericId, namusOk } from "../src/lib/namusRecord.ts";

export const maxDuration = 30;

export const config = {
  maxDuration: 30,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(200).json({ success: false, error: "GET only" });

  const raw = req.query?.id ?? req.query?.url ?? req.query?.q;
  const query = Array.isArray(raw) ? raw[0] : raw;
  try {
    const body = await lookupNamus(typeof query === "string" ? query : "");
    return res.status(200).json(body);
  } catch (err) {
    console.error("[namus] handler failed", err);
    const digits = namusNumericId(typeof query === "string" ? query : "");
    return res.status(200).json(digits ? namusOk(fallbackNamusRecord(digits), "fallback") : { success: false, error: "Enter a NamUs ID such as MP2316." });
  }
}
