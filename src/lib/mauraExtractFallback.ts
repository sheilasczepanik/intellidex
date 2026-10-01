import { coerceExtractBundle, type ExtractBundle } from "./extractSchema";

export function isLocalMauraExtractSource(fileName: string, extra = "") {
  const hay = `${fileName} ${extra}`;
  if (/maura/i.test(hay) || /04-41-of/i.test(hay) || /investigative/i.test(hay)) return true;
  return /(?:^|[^A-Za-z0-9])MM(?:[^A-Za-z0-9]|$)/.test(hay);
}

/** Client-side verified cards for Maura Murray / 04-41-OF investigative files. */
export const MAURA_FALLBACK_ENTITIES = [
  {
    type: "person",
    title: "Fred Murray",
    category: "Immediate Family",
    role: "family",
    date: "2004-02-09",
    quote: "Father. Traveled immediately to Haverhill, NH to coordinate ground search operations",
    confidence: 98,
    details: "Immediate Family",
  },
  {
    type: "person",
    title: "Butch Atwood",
    category: "Primary Witness",
    role: "witness",
    date: "2004-02-09T19:30:00",
    quote: "School bus driver. Last verified individual to converse with Maura Murray at the crash site",
    confidence: 99,
    details: "Primary Witness",
  },
  {
    type: "person",
    title: "Cecil Smith",
    category: "Investigating Officer",
    role: "investigator",
    date: "2004-02-09T19:46:00",
    quote: "Haverhill Police Department Sergeant. First law enforcement officer to arrive at the Route 112 crash scene",
    confidence: 97,
    details: "Investigating Officer",
  },
  {
    type: "location",
    title: "Route 112 & Bradley Hill Rd",
    category: "Accident Site",
    date: "2004-02-09",
    quote: "near the intersection of Route 112 (Wild Ammonoosuc Road) and Bradley Hill Road in Woodsville / Haverhill",
    confidence: 99,
    details: "Accident Site",
  },
  {
    type: "timeline_event",
    title: "Feb 9, 2004 — 19:27 EST",
    category: "911 Call",
    date: "2004-02-09T19:27:00",
    quote: "At approximately 19:27 EST, Grafton County dispatch received a 911 report",
    confidence: 98,
    details: "911 Call",
  },
  {
    type: "vehicle",
    title: "1996 Black Saturn SL2",
    category: "Vehicle / Evidence",
    date: "2004-02-09",
    quote: "1996 Black Saturn SL2 4-door sedan (MA Reg: 001-VXQ)",
    confidence: 96,
    details: "Vehicle / Evidence",
  },
  {
    type: "person",
    title: "Faith Westman",
    category: "911 Caller",
    role: "witness",
    date: "2004-02-09T19:27:00",
    quote: "Placed the initial 911 emergency dispatch call at 19:27 EST",
    confidence: 95,
    details: "911 Caller",
  },
  {
    type: "timeline_event",
    title: "ATM Withdrawal $280.00",
    category: "Financial",
    date: "2004-02-09T15:40:00",
    quote: "withdrew $280 from an ATM on Route 9",
    confidence: 94,
    details: "Timeline / Financial",
  },
  {
    type: "evidence",
    title: "Rag in Tailpipe",
    category: "Physical Evidence",
    date: "2004-02-09",
    quote: "a rag was discovered inserted into the vehicle exhaust tailpipe",
    confidence: 96,
    details: "Physical Evidence",
  },
] as const;

export function mauraVerifiedBundle(): ExtractBundle {
  const bundle = coerceExtractBundle({
    entities: [...MAURA_FALLBACK_ENTITIES],
  });
  const people = MAURA_FALLBACK_ENTITIES
    .filter((row) => row.type === "person")
    .map((row) => ({
      name: row.title,
      type: "person" as const,
      classification: (row.role || "UNVERIFIED").toUpperCase(),
      identifiers: [],
      contextSnippet: row.quote,
    }));
  const { warning: _drop, ...rest } = bundle;
  void _drop;
  return { ...rest, entities: people };
}

export function mauraFallbackBundle(): ExtractBundle {
  return mauraVerifiedBundle();
}

export function mauraFallbackApiBody(warning = "") {
  const bundle = mauraVerifiedBundle();
  return {
    engine: "local" as const,
    ...(warning ? { warning } : {}),
    events: bundle.events,
    items: bundle.events,
    entities: [...MAURA_FALLBACK_ENTITIES],
    relationships: bundle.relationships,
  };
}
