import type { VercelRequest, VercelResponse } from "@vercel/node";
import { lookupNamus } from "../server/namusLookup.ts";

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
  if (req.method !== "GET") return res.status(200).json({ error: "GET only" });

  try {
    const raw = req.query?.id ?? req.query?.url ?? req.query?.q;
    const query = Array.isArray(raw) ? raw[0] : raw;
    const body = await lookupNamus(typeof query === "string" ? query : "");
    return res.status(200).json(body);
  } catch (err) {
    console.error("[namus] handler failed", err);
    return res.status(200).json({ error: "NamUs lookup failed." });
  }
}
