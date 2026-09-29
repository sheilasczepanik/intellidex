import { normalizePersonRole } from "../utils/roleBadge";
import {
  canonicalEntityType,
  normalizeBoundingBox,
  normalizeRelationshipType,
  parsePageNumber,
  relationshipDisplayLabel,
  type EntityType,
  type RelationshipType,
  type SourceBoundingBox,
} from "../types";

export type ExtractEntityHint = {
  id: string;
  name: string;
  type: string;
  role: string;
};

export type ExtractCategory =
  | "person"
  | "location"
  | "vehicle"
  | "telecom"
  | "time"
  | "evidence"
  | "communication"
  | "time_window"
  | "physical_description";

export const VERIFY_CATEGORIES = [
  "person",
  "location",
  "vehicle",
  "telecom",
  "time",
  "evidence",
  "communication",
] as const;

export type ExtractedEvent = {
  timestamp: string | null;
  timestampLabel: string;
  entityId: string | null;
  entityName: string;
  entityType: EntityType;
  suggestNewEntity: boolean;
  newEntityType: EntityType | null;
  category: ExtractCategory;
  title: string;
  snippet: string;
  rawQuote: string;
  details: string;
  confidence: number;
  citation: string;
  pageNumber?: number;
  exactQuote: string;
  boundingBox?: SourceBoundingBox;
};

export const EXTRACT_SYSTEM = `You are a strict JSON extractor for investigative source text (police reports, affidavits, field notes, interview logs).

Return ONLY valid JSON. Do not wrap in markdown. Shape:
{
  "items": [
    {
      "type": "event",
      "category": "person" | "location" | "vehicle" | "telecom" | "time" | "evidence" | "communication",
      "title": "Concise headline (e.g., M. Webb check-in at Blue Heron Motel)",
      "entityName": "Associated entity name, vehicle, or place",
      "timestamp": "HH:MM (24-hour) or date/time string if mentioned, else null",
      "rawQuote": "Exact verbatim excerpt from the document text",
      "exactQuote": "Same verbatim snippet used for source highlighting",
      "pageNumber": 1,
      "boundingBox": { "x": 12, "y": 40, "width": 55, "height": 8 },
      "confidence": 0.95,
      "details": "Factual context or observation notes"
    }
  ]
}

Exhaustive multi-category parsing — emit a separate item for every distinct fact. Do not collapse people, places, vehicles, times, and signals into one vague event.

- category "person": every named individual (officers, complainants, witnesses, suspects, victims, associates).
- category "location": every physical place, address, room, business, road, dock, motel.
- category "vehicle": make, model, color, plate, ANPR, movements.
- category "telecom": cell tower pings, handset registration, IMEI, GPS, camera/CCTV systems as digital signals.
- category "time": every timestamp, clock, date, or time window.
- category "evidence": physical descriptions, clothing, weapons, forensic traces, documents as exhibits.
- category "communication": calls, radio, interviews, messages, dispatch, statements.

Field rules:
- rawQuote and exactQuote MUST be copied verbatim from the source (never invented). exactQuote is the shortest unique span for highlighting.
- pageNumber is 1-indexed. For images use 1. For plain notes omit or use 1.
- boundingBox is optional approximate location on that page/image as percentages 0–100 (x, y, width, height from the top-left). Omit when unknown.
- timestamp: 24-hour HH:MM or a date/time string when the source states one; otherwise null.
- entityName: the person, place, vehicle, or system the fact attaches to. Match a known case entity name when possible.
- entityId: copy the id from the known-entity list on a case-insensitive name match; otherwise null.
- confidence: 0.0–1.0
- Prefer recall. If OCR artifacts or formatting noise appear, ignore garbled symbols and extract intelligible factual statements.
- Also return roster entities and directed relationship edges whenever a person is tied to a vehicle, phone, address, tower, or other person:
{
  "entities": [{ "name": string, "type": "person"|"vehicle"|"location"|"phone"|"digital"|"exhibit", "classification": string, "identifiers": string[] }],
  "relationships": [{ "sourceEntity": "Bryan Kohberger", "targetEntity": "White Hyundai Elantra", "relationshipType": "operator_driver"|"registered_owner"|"passenger"|"residence"|"crime_scene"|"last_known_location"|"phone_subscriber"|"cell_tower_ping"|"associate_of", "label": "Observed driving", "confidence": 0.9 }]
}
- Only return {"items": []} when there are no intelligible facts at all.`;

export function unwrapModelJson(raw: string) {
  let s = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  else s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Model did not return JSON.");
  }
  return s.slice(start, end + 1);
}

export function parseExtractedEvents(raw: string): ExtractedEvent[] {
  try {
    const parsed = JSON.parse(unwrapModelJson(raw)) as { items?: unknown; events?: unknown };
    const rows = Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.events)
        ? parsed.events
        : [];
    return rows.map(normalizeEvent).filter((e) => e.title.trim() || e.rawQuote.trim() || e.entityName.trim());
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid JSON";
    throw new Error(`Could not parse Claude JSON (${detail}).`);
  }
}

function normalizeCategory(value: unknown): ExtractCategory {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("telecom") || s.includes("ping") || s.includes("tower") || s.includes("imei") || s.includes("handset")) return "telecom";
  if (s === "time" || s.includes("time_window") || s.includes("timestamp") || s.includes("clock")) return "time";
  if (s.includes("comm") || s.includes("radio") || s.includes("dispatch") || s.includes("interview") || s.includes("call")) return "communication";
  if (s.includes("evidence") || s.includes("forensic") || s.includes("weapon") || s.includes("physical") || s.includes("descrip")) return "evidence";
  if (s.includes("place") || s.includes("location") || s.includes("address")) return "location";
  if (s.includes("vehicle") || s.includes("car") || s.includes("plate") || s.includes("elantra")) return "vehicle";
  return "person";
}

function normalizeEntityType(value: unknown, category: ExtractCategory): EntityType {
  const s = String(value ?? "").toLowerCase();
  if (s === "phone") return "phone";
  if (s === "digital" || s === "telecom") return "digital";
  if (s === "exhibit" || s === "evidence") return "exhibit";
  if (s === "vehicle") return "vehicle";
  if (s === "place" || s === "location") return "place";
  if (s === "person") return "person";
  const canon = canonicalEntityType(s || category);
  if (canon === "location") return "place";
  if (category === "vehicle") return "vehicle";
  if (category === "location" || category === "time" || category === "time_window") return "place";
  if (category === "telecom") return "digital";
  if (category === "evidence") return "exhibit";
  return canon === "person" ? "person" : canon;
}

function normalizeEvent(row: unknown): ExtractedEvent {
  const r = (row && typeof row === "object") ? row as Record<string, unknown> : {};
  const category = normalizeCategory(r.category ?? r.newEntityType);
  const entityType = normalizeEntityType(r.entityType ?? r.newEntityType, category);
  const rawQuote = String(r.rawQuote ?? r.exactQuote ?? r.snippet ?? "").trim();
  const exactQuote = String(r.exactQuote ?? rawQuote).trim();
  const ts = r.timestamp === null || r.timestamp === undefined ? "" : String(r.timestamp).trim();
  const timestampLabel = String(r.timestampLabel ?? ts ?? "Unknown").trim() || "Unknown";
  const entityName = String(r.entityName ?? "Unknown").trim() || "Unknown";
  const entityId = typeof r.entityId === "string" && r.entityId.trim() ? r.entityId.trim() : null;
  const conf = Number(r.confidence);
  const pageNumber = parsePageNumber(r.pageNumber ?? r.page);
  const boundingBox = normalizeBoundingBox(r.boundingBox ?? r.bbox);
  return {
    timestamp: ts || null,
    timestampLabel,
    entityId,
    entityName,
    entityType,
    suggestNewEntity: r.suggestNewEntity == null ? !entityId : Boolean(r.suggestNewEntity),
    newEntityType: entityType,
    category,
    title: String(r.title ?? "Untitled fact").trim() || "Untitled fact",
    snippet: rawQuote,
    rawQuote,
    details: String(r.details ?? r.citation ?? "").trim(),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.8,
    citation: String(r.citation ?? (pageNumber ? `p.${pageNumber}` : r.category ?? category)),
    pageNumber,
    exactQuote: exactQuote || rawQuote,
    boundingBox,
  };
}

export type ExtractedRosterEntity = {
  name: string;
  type: EntityType;
  classification: string;
  identifiers: string[];
};

export type ExtractedRelationship = {
  sourceEntity: string;
  targetEntity: string;
  sourceType: EntityType;
  targetType: EntityType;
  relationshipType: RelationshipType;
  label: string;
  confidence: number;
};

export type ExtractBundle = {
  events: ExtractedEvent[];
  entities: ExtractedRosterEntity[];
  relationships: ExtractedRelationship[];
};

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? row as Record<string, unknown> : {};
}

function normalizeRosterEntity(row: unknown): ExtractedRosterEntity | null {
  const r = asRecord(row);
  const name = String(r.name ?? r.entityName ?? "").trim();
  if (!name) return null;
  const identifiers = Array.isArray(r.identifiers)
    ? r.identifiers.map((x) => String(x).trim()).filter(Boolean)
    : [];
  return {
    name,
    type: normalizeEntityType(r.type ?? r.entityType, normalizeCategory(r.type ?? r.category)),
    classification: String(r.classification ?? r.role ?? "UNVERIFIED").trim() || "UNVERIFIED",
    identifiers,
  };
}

function normalizeExtractedRelationship(row: unknown): ExtractedRelationship | null {
  const r = asRecord(row);
  const sourceEntity = String(r.sourceEntity ?? r.source ?? r.from ?? "").trim();
  const targetEntity = String(r.targetEntity ?? r.target ?? r.to ?? "").trim();
  if (!sourceEntity || !targetEntity || sourceEntity.toLowerCase() === targetEntity.toLowerCase()) return null;
  const relationshipType = normalizeRelationshipType(r.relationshipType ?? r.type);
  const conf = Number(r.confidence);
  return {
    sourceEntity,
    targetEntity,
    sourceType: normalizeEntityType(r.sourceType ?? r.sourceEntityType, "person"),
    targetType: normalizeEntityType(r.targetType ?? r.targetEntityType, "location"),
    relationshipType,
    label: relationshipDisplayLabel(relationshipType, String(r.label ?? "")),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.75,
  };
}

export function parseExtractGraph(raw: unknown): Pick<ExtractBundle, "entities" | "relationships"> {
  const parsed = (raw && typeof raw === "object" ? raw : {}) as { entities?: unknown; relationships?: unknown; links?: unknown };
  const entities = (Array.isArray(parsed.entities) ? parsed.entities : [])
    .map(normalizeRosterEntity)
    .filter((e): e is ExtractedRosterEntity => Boolean(e));
  const relRaw = Array.isArray(parsed.relationships) ? parsed.relationships
    : Array.isArray(parsed.links) ? parsed.links
    : [];
  const relationships = relRaw
    .map(normalizeExtractedRelationship)
    .filter((e): e is ExtractedRelationship => Boolean(e));
  return { entities, relationships };
}

export function parseExtractBundle(raw: string): ExtractBundle {
  const parsed = JSON.parse(unwrapModelJson(raw)) as Record<string, unknown>;
  const events = parseExtractedEvents(JSON.stringify(parsed));
  const graph = parseExtractGraph(parsed);
  const inferred = events
    .filter((e) => e.entityName && e.entityName !== "Unknown")
    .map((e) => ({
      name: e.entityName,
      type: e.entityType,
      classification: "UNVERIFIED",
      identifiers: [] as string[],
    }));
  const names = new Set(graph.entities.map((e) => e.name.toLowerCase()));
  for (const row of inferred) {
    if (!names.has(row.name.toLowerCase())) {
      names.add(row.name.toLowerCase());
      graph.entities.push(row);
    }
  }
  return { events, entities: graph.entities, relationships: graph.relationships };
}

export const CLAUDE_MAX_CHARS = 12_000;
export const CLAUDE_MAX_PAGES = 5;
export const CLAUDE_RETRY_PAGES = 3;

/** Strip control chars and hard-cap for Claude. PDF OCR often injects NUL / C0 bytes that 500 the API. */
export function sanitizeExtractText(text: string, maxChars = CLAUDE_MAX_CHARS) {
  const cleaned = text
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}\n\n[Truncated for model window.]`;
}

export function windowSourceText(text: string, opts?: { maxPages?: number; maxChars?: number }) {
  const maxPages = opts?.maxPages ?? CLAUDE_MAX_PAGES;
  const maxChars = opts?.maxChars ?? CLAUDE_MAX_CHARS;
  const chunks = text.split(/(?=--- Page \d+ ---)/).map((part) => part.trim()).filter(Boolean);
  const paged = chunks.length > 1 ? chunks.slice(0, Math.max(1, maxPages)).join("\n\n") : text;
  return sanitizeExtractText(paged, maxChars);
}

export function userExtractPrompt(
  text: string,
  fileName: string,
  entities: ExtractEntityHint[],
  opts?: { summary?: boolean; maxPages?: number; maxChars?: number },
) {
  const excerpt = windowSourceText(text, { maxPages: opts?.maxPages, maxChars: opts?.maxChars });
  return [
    `Source file: ${fileName}`,
    opts?.summary
      ? "Mode: condensed summary of this excerpt only. Prefer fewer, high-confidence items."
      : "Mode: exhaustive extraction — every person, location, vehicle, telecom signal, timestamp, evidence fact, and communication.",
    "Known case entities (match entityId / entityName when possible):",
    JSON.stringify(entities, null, 2),
    "",
    "Source text:",
    excerpt,
  ].join("\n");
}

export type ScoutedEntity = {
  name: string;
  type: "person" | "place" | "vehicle";
  role: string;
  quote: string;
  details: string;
  sourceFile: string;
};

export const ENTITY_SCOUT_SYSTEM = `You are doing fast entity reconnaissance on investigative source text.

Return ONLY valid JSON (no markdown):
{
  "entities": [
    {
      "name": "White Hyundai Elantra",
      "type": "vehicle",
      "role": "TRACKED",
      "quote": "white sedan observed making a three-point turn",
      "details": "No front plate. Seen near King Road.",
      "sourceFile": "affidavit.pdf"
    }
  ]
}

Extract unique candidate identities in three types only:
- type "person" — suspects, persons of interest, victims, witnesses, associates (role: SUSPECT, person_of_interest, WITNESS, VICTIM, ASSOCIATE, or UNVERIFIED)
- type "place" — rooms, streets, businesses, addresses, cell towers (role: PRIMARY, REGISTERED, or UNVERIFIED)
- type "vehicle" — make/model/color/plates (role: TRACKED, REGISTERED, or UNVERIFIED)

Rules:
- One card per unique identity. Merge aliases onto the best canonical name.
- For people, use SUSPECT only when named as a suspect; use person_of_interest when they are a person of interest / POI; never use SUBJECT.
- quote must be copied from the source, not invented.
- Skip unnamed crowds, generic "officers" unless a specific name or unit is given.
- If the text is unreadable OCR garbage, return {"entities": []}.
- Do not wrap JSON in markdown.`;

export function parseScoutedEntities(raw: string): ScoutedEntity[] {
  try {
    const parsed = JSON.parse(unwrapModelJson(raw)) as { entities?: unknown };
    const rows = Array.isArray(parsed.entities) ? parsed.entities : [];
    return rows.map(normalizeScout).filter((e) => e.name.trim().length > 1);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid JSON";
    throw new Error(`Could not parse Claude JSON (${detail}).`);
  }
}

function normalizeScout(row: unknown): ScoutedEntity {
  const r = (row && typeof row === "object") ? row as Record<string, unknown> : {};
  const typeRaw = String(r.type ?? "").toLowerCase();
  const type = typeRaw === "vehicle" ? "vehicle" as const
    : typeRaw === "place" || typeRaw === "location" ? "place" as const
      : "person" as const;
  return {
    name: String(r.name ?? "").trim() || "Unknown",
    type,
    role: type === "person"
      ? normalizePersonRole(String(r.role ?? "UNVERIFIED").trim() || "UNVERIFIED")
      : (String(r.role ?? "UNVERIFIED").trim() || "UNVERIFIED"),
    quote: String(r.quote ?? r.rawQuote ?? r.snippet ?? "").trim(),
    details: String(r.details ?? "").trim(),
    sourceFile: String(r.sourceFile ?? "").trim(),
  };
}

export function userScoutPrompt(text: string, fileName: string, entities: ExtractEntityHint[]) {
  return [
    `Source file(s): ${fileName}`,
    "Already known case entities (do not repeat these):",
    JSON.stringify(entities, null, 2),
    "",
    "Source text:",
    windowSourceText(text),
  ].join("\n");
}
