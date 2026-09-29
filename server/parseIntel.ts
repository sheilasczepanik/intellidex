import { MODEL_NAME, postAnthropicMessages } from "./anthropicModels.ts";

export type ParsedIntelClaim = {
  category: "person" | "vehicle" | "location" | "alibi" | "sighting" | "evidence";
  claimText: string;
  extractedTimestamp: string | null;
  verbatimQuote: string;
  confidence: number;
};

export class IntelParseError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "IntelParseError";
    this.status = status;
  }
}

const INTEL_SYSTEM = `You are an OSINT / investigative triage engine. Decompose unvetted external tips into discrete factual claims. Identify cited persons, vehicle descriptions, locations, timestamps, and alibi assertions. Never invent facts. Return STRICT JSON ONLY.`;

const INTEL_USER = (text: string) => `Decompose this unvetted external tip into discrete factual claims. Identify cited persons, vehicle descriptions, locations, timestamps, and alibi assertions. Return strict JSON array of claims.

Tip transcript:
"""
${text.slice(0, 12000)}
"""

Return STRICT JSON:
{
  "claims": [
    {
      "category": "person" | "vehicle" | "location" | "alibi" | "sighting" | "evidence",
      "claimText": string,
      "extractedTimestamp": string | null,
      "verbatimQuote": string,
      "confidence": number
    }
  ]
}`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const CATEGORIES = new Set(["person", "vehicle", "location", "alibi", "sighting", "evidence"]);

export function parseIntelClaimsJson(rawReply: string): ParsedIntelClaim[] {
  try {
    const cleaned = String(rawReply || "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    const parsed: unknown = JSON.parse(match ? match[0] : "[]");
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(asRecord(parsed).claims)
        ? asRecord(parsed).claims as unknown[]
        : [];
    return rows.flatMap((row) => {
      const r = asRecord(row);
      const claimText = typeof r.claimText === "string" ? r.claimText.trim()
        : typeof r.title === "string" ? r.title.trim()
        : "";
      if (!claimText) return [];
      const category = CATEGORIES.has(String(r.category)) ? String(r.category) as ParsedIntelClaim["category"] : "evidence";
      const quote = typeof r.verbatimQuote === "string" && r.verbatimQuote.trim()
        ? r.verbatimQuote.trim()
        : (typeof r.rawQuote === "string" ? r.rawQuote.trim() : claimText);
      const conf = Number(r.confidence);
      return [{
        category,
        claimText,
        extractedTimestamp: typeof r.extractedTimestamp === "string" && r.extractedTimestamp.trim() ? r.extractedTimestamp.trim() : null,
        verbatimQuote: quote,
        confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      }];
    });
  } catch {
    return [];
  }
}

export async function parseIntelWithAnthropic(apiKey: string, text: string): Promise<ParsedIntelClaim[]> {
  try {
    const raw = await postAnthropicMessages({
      apiKey,
      system: INTEL_SYSTEM,
      user: INTEL_USER(text),
      maxTokens: 2500,
      preferredModel: MODEL_NAME,
    });
    let data: Record<string, unknown> = {};
    try {
      data = asRecord(JSON.parse(raw || "{}"));
    } catch {
      return parseIntelClaimsJson(raw);
    }
    const blocks = Array.isArray(data.content) ? data.content : [];
    const reply = blocks
      .map((b) => {
        const row = asRecord(b);
        return row.type === "text" && typeof row.text === "string" ? row.text : "";
      })
      .join("\n");
    return parseIntelClaimsJson(reply || raw);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
    throw new IntelParseError(status, err instanceof Error ? err.message : "Intel parse failed.");
  }
}
