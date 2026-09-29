import { getLocalApiKey, getLocalProvider } from "./settings";

export type ParsedIntelClaim = {
  category: "person" | "vehicle" | "location" | "alibi" | "sighting" | "evidence";
  claimText: string;
  extractedTimestamp: string | null;
  verbatimQuote: string;
  confidence: number;
};

export async function parseExternalIntel(text: string): Promise<ParsedIntelClaim[]> {
  const res = await fetch("/api/parse-intel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-dossier-key": getLocalApiKey(),
      "x-dossier-provider": getLocalProvider(),
    },
    body: JSON.stringify({ text, rawContent: text, type: "intel" }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText })) as { error?: unknown };
    const message = typeof errorData.error === "string" && errorData.error.trim()
      ? errorData.error
      : `Intel parse failed (${res.status})`;
    throw new Error(message);
  }
  const json = await res.json().catch(() => ({})) as { claims?: ParsedIntelClaim[] };
  return Array.isArray(json.claims) ? json.claims : [];
}
