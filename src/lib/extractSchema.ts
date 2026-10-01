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
  tier?: "primary" | "secondary";
};

export const EXTRACT_SYSTEM = `You are a missing persons intelligence specialist. Extract high-confidence investigative facts from police blotters, missing flyers, witness statements, search logs, and news reports.

Return ONLY a JSON object with this exact shape:
{
  "subject": {
    "name": string,
    "age": string,
    "identifyingMarks": string[],
    "clothingLastSeen": string,
    "medicalVulnerabilities": string[]
  },
  "lks": {
    "date": string,
    "time": string,
    "location": string,
    "circumstances": string
  },
  "sightingsAndEvents": [
    { "date": string, "time": string, "title": string, "description": string, "tier": "primary" | "secondary" }
  ],
  "searchLocations": [
    { "name": string, "type": "last_seen" | "item_recovered" | "cell_ping" | "search_grid", "description": string }
  ],
  "contacts": [
    { "name": string, "role": string, "relation": string }
  ],
  "entities": [
    { "name": string, "category": "person" | "location" | "vehicle" | "phone" | "exhibit", "role": string, "context": string }
  ],
  "events": [
    { "date": string, "time": string, "title": string, "summary": string, "sourceReference": string }
  ]
}

Rules:
- Normalize OCR typos before extracting (e.g. MASSACHUSEATS → Massachusetts; fix split names and garbled titles).
- Distinguish report/file dates from incident dates. Prefer the incident / last-known-sighting date.
- Extract only high-confidence items: named people, last-known locations, times, key narrative statements, vehicles, and physical evidence.
- Format dates as YYYY-MM-DD when possible; times as HH:MM (24h) or "".
- title and summary must be clean investigator language, not raw OCR fragments.
- tier "primary" for official records / verified sightings; "secondary" for tips and press.
- Skip court boilerplate, headers, page numbers, and unreadable OCR garbage.
- If the excerpt has no search facts, return empty arrays and empty strings.`;

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
    throw new Error(`Could not parse model JSON (${detail}).`);
  }
}

function normalizeCategory(value: unknown): ExtractCategory {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("telecom") || s.includes("phone") || s.includes("ping") || s.includes("tower") || s.includes("imei") || s.includes("handset")) return "telecom";
  if (s === "time" || s.includes("time_window") || s.includes("timestamp") || s.includes("clock")) return "time";
  if (s.includes("comm") || s.includes("radio") || s.includes("dispatch") || s.includes("interview") || s.includes("call")) return "communication";
  if (s.includes("exhibit") || s.includes("evidence") || s.includes("forensic") || s.includes("weapon") || s.includes("physical") || s.includes("descrip")) return "evidence";
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
  const date = String(r.date ?? "").trim();
  const time = String(r.time ?? "").trim();
  const composedTs = [date, time].filter(Boolean).join(" ");
  const category = normalizeCategory(r.category ?? r.newEntityType);
  const entityType = normalizeEntityType(r.entityType ?? r.newEntityType ?? r.category, category);
  const rawQuote = String(r.sourceReference ?? r.rawQuote ?? r.exactQuote ?? r.snippet ?? "").trim();
  const exactQuote = String(r.exactQuote ?? rawQuote).trim();
  const ts = r.timestamp === null || r.timestamp === undefined ? composedTs : String(r.timestamp).trim();
  const timestampLabel = String(r.timestampLabel ?? (composedTs || ts || "Unknown")).trim() || "Unknown";
  const entityName = String(r.entityName ?? r.name ?? "Unknown").trim() || "Unknown";
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
    details: String(r.summary ?? r.details ?? r.citation ?? "").trim(),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.8,
    citation: String(r.sourceReference ?? r.citation ?? (pageNumber ? `p.${pageNumber}` : r.category ?? category)),
    pageNumber,
    exactQuote: exactQuote || rawQuote,
    boundingBox,
    tier: String(r.tier ?? "").toLowerCase() === "secondary" ? "secondary" : "primary",
  };
}

export type ExtractedRosterEntity = {
  name: string;
  type: EntityType;
  classification: string;
  identifiers: string[];
  contextSnippet?: string;
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

export type ExtractedSearchLocation = {
  name: string;
  type: "last_seen" | "item_recovered" | "cell_ping" | "search_grid";
  description: string;
};

export type ExtractedSubject = {
  name: string;
  age: string;
  identifyingMarks: string[];
  clothingLastSeen: string;
  medicalVulnerabilities: string[];
};

export type ExtractedLks = {
  date: string;
  time: string;
  location: string;
  circumstances: string;
};

export type ExtractedContactHint = {
  name: string;
  role: string;
  relation: string;
};

export type ExtractBundle = {
  events: ExtractedEvent[];
  entities: ExtractedRosterEntity[];
  relationships: ExtractedRelationship[];
  subject?: ExtractedSubject | null;
  lks?: ExtractedLks | null;
  searchLocations?: ExtractedSearchLocation[];
  contacts?: ExtractedContactHint[];
  warning?: string;
};

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  const s = String(value ?? "").trim();
  return s ? s.split(/[;|,]/).map((x) => x.trim()).filter(Boolean) : [];
}

function normalizeSearchLocType(value: unknown): ExtractedSearchLocation["type"] {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("cell") || s.includes("ping") || s.includes("tower")) return "cell_ping";
  if (s.includes("grid") || s.includes("trail") || s.includes("search")) return "search_grid";
  if (s.includes("item") || s.includes("vehicle") || s.includes("recover") || s.includes("belong")) return "item_recovered";
  return "last_seen";
}

export function harvestMissingPersonFields(parsed: Record<string, unknown>): Pick<ExtractBundle, "subject" | "lks" | "searchLocations" | "contacts" | "events"> {
  const sub = asRecord(parsed.subject);
  const lks = asRecord(parsed.lks);
  const subject: ExtractedSubject | null = String(sub.name ?? "").trim()
    ? {
      name: String(sub.name).trim(),
      age: String(sub.age ?? "").trim(),
      identifyingMarks: stringList(sub.identifyingMarks),
      clothingLastSeen: String(sub.clothingLastSeen ?? "").trim(),
      medicalVulnerabilities: stringList(sub.medicalVulnerabilities),
    }
    : null;
  const lksRow: ExtractedLks | null = (lks.date || lks.location || lks.circumstances)
    ? {
      date: String(lks.date ?? "").trim(),
      time: String(lks.time ?? "").trim(),
      location: String(lks.location ?? "").trim(),
      circumstances: String(lks.circumstances ?? "").trim(),
    }
    : null;
  const searchLocations = (Array.isArray(parsed.searchLocations) ? parsed.searchLocations : [])
    .map((row) => {
      const r = asRecord(row);
      const name = String(r.name ?? "").trim();
      if (!name) return null;
      return {
        name,
        type: normalizeSearchLocType(r.type),
        description: String(r.description ?? r.context ?? "").trim(),
      } as ExtractedSearchLocation;
    })
    .filter((x): x is ExtractedSearchLocation => Boolean(x));
  const contacts = (Array.isArray(parsed.contacts) ? parsed.contacts : [])
    .map((row) => {
      const r = asRecord(row);
      const name = String(r.name ?? "").trim();
      if (!name) return null;
      return {
        name,
        role: String(r.role ?? "").trim(),
        relation: String(r.relation ?? "").trim(),
      } as ExtractedContactHint;
    })
    .filter((x): x is ExtractedContactHint => Boolean(x));
  const sightings = (Array.isArray(parsed.sightingsAndEvents) ? parsed.sightingsAndEvents : [])
    .map(normalizeEvent)
    .map((ev) => ({
      ...ev,
      details: ev.details || String(asRecord(ev).description ?? ""),
    }));
  return { subject, lks: lksRow, searchLocations, contacts, events: sightings };
}

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
    contextSnippet: String(r.context ?? r.contextSnippet ?? r.quote ?? "").trim() || undefined,
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
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(unwrapModelJson(raw)) as Record<string, unknown>;
  } catch {
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    if (!match) return { events: [], entities: [], relationships: [] };
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return { events: [], entities: [], relationships: [] };
    }
  }
  let events: ExtractedEvent[] = [];
  try {
    events = parseExtractedEvents(JSON.stringify(parsed));
  } catch {
    events = [];
  }
  const graph = parseExtractGraph(parsed);
  const mp = harvestMissingPersonFields(parsed);
  const eventsByKey = new Map<string, ExtractedEvent>();
  for (const ev of [...mp.events, ...events]) {
    const key = `${ev.title}|${ev.timestampLabel}|${ev.entityName}`.toLowerCase();
    if (!eventsByKey.has(key)) eventsByKey.set(key, ev);
  }
  events = [...eventsByKey.values()];
  if (mp.subject?.name) {
    graph.entities.unshift({
      name: mp.subject.name,
      type: "person",
      classification: "MISSING_PERSON",
      identifiers: [
        ...mp.subject.identifyingMarks,
        ...(mp.subject.age ? [`age ${mp.subject.age}`] : []),
      ],
      contextSnippet: [mp.subject.clothingLastSeen, mp.subject.medicalVulnerabilities.join("; ")].filter(Boolean).join(" · ") || undefined,
    });
  }
  if (mp.lks?.location) {
    graph.entities.push({
      name: mp.lks.location,
      type: "place",
      classification: "last_seen",
      identifiers: [],
      contextSnippet: mp.lks.circumstances || undefined,
    });
    if (!events.some((e) => /last known sighting|\blks\b/i.test(e.title))) {
      events.unshift({
        timestamp: [mp.lks.date, mp.lks.time].filter(Boolean).join(" ") || null,
        timestampLabel: [mp.lks.date, mp.lks.time].filter(Boolean).join(" ") || "LKS",
        entityId: null,
        entityName: mp.subject?.name || mp.lks.location,
        entityType: "person",
        suggestNewEntity: true,
        newEntityType: "person",
        category: "time",
        title: "Last Known Sighting (LKS)",
        snippet: mp.lks.circumstances,
        rawQuote: mp.lks.circumstances,
        details: mp.lks.circumstances,
        confidence: 0.9,
        citation: mp.lks.location,
        pageNumber: undefined,
        exactQuote: mp.lks.circumstances,
        boundingBox: undefined,
        tier: "primary",
      });
    }
  }
  for (const loc of mp.searchLocations ?? []) {
    graph.entities.push({
      name: loc.name,
      type: "place",
      classification: loc.type,
      identifiers: [loc.type],
      contextSnippet: loc.description || undefined,
    });
  }
  for (const c of mp.contacts ?? []) {
    graph.entities.push({
      name: c.name,
      type: "person",
      classification: c.role || "ASSOCIATE",
      identifiers: [],
      contextSnippet: c.relation || undefined,
    });
  }
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
  return {
    events,
    entities: graph.entities,
    relationships: graph.relationships,
    subject: mp.subject,
    lks: mp.lks,
    searchLocations: mp.searchLocations,
    contacts: mp.contacts,
  };
}

export const EXTRACT_MAX_CHARS = 60_000;
/** ~4k tokens — first 4–5 pages so GPT-4o returns in a few seconds. */
export const EXTRACT_MODEL_MAX_CHARS = 16_000;
export const CLAUDE_MAX_CHARS = EXTRACT_MODEL_MAX_CHARS;
export const EXTRACT_SERVICE_UNAVAILABLE =
  "Extraction service unavailable (verify API key or document size)";
export const EXTRACT_CORE_PAGES = 5;
export const CLAUDE_MAX_PAGES = EXTRACT_CORE_PAGES;
export const CLAUDE_RETRY_PAGES = EXTRACT_CORE_PAGES;
export const EXTRACT_CHUNK_TRIGGER = EXTRACT_MAX_CHARS;
export const EXTRACT_CHUNK_SIZE = EXTRACT_MAX_CHARS;
export const EXTRACT_CHUNK_OVERLAP = 0;

const FACT_MARKERS = [
  /statement of (the )?facts/i,
  /factual (background|allegations)/i,
  /allegations common to all/i,
  /general allegations/i,
  /substantive allegations/i,
  /cause of action/i,
  /background facts/i,
];

/** Prefer the statement of facts / allegations when a filing exceeds the GPT-4o context budget. */
export function prioritizeLegalFacts(text: string, maxChars = EXTRACT_MAX_CHARS) {
  const cleaned = sanitizeExtractText(text, Number.MAX_SAFE_INTEGER).replace(/\n\n\[Truncated for model window.\]$/, "");
  if (cleaned.length <= maxChars) return cleaned;
  let start = 0;
  for (const re of FACT_MARKERS) {
    const match = re.exec(cleaned);
    if (match && match.index >= 0) {
      start = match.index;
      break;
    }
  }
  const window = cleaned.slice(start, start + maxChars);
  if (window.trim().length < Math.min(8_000, maxChars * 0.35) && start > 0) {
    return cleaned.slice(0, maxChars);
  }
  return window;
}

/** Split long source text into overlapping windows for sequential Claude calls. */
export function splitExtractChunks(text: string, opts?: { trigger?: number; size?: number; overlap?: number }) {
  const trigger = opts?.trigger ?? EXTRACT_CHUNK_TRIGGER;
  const size = opts?.size ?? EXTRACT_CHUNK_SIZE;
  const overlap = opts?.overlap ?? EXTRACT_CHUNK_OVERLAP;
  const cleaned = sanitizeExtractText(text, Number.MAX_SAFE_INTEGER).replace(/\n\n\[Truncated for model window.\]$/, "");
  if (cleaned.length <= trigger) return [sanitizeExtractText(cleaned, size)];
  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length && chunks.length < 8) {
    const end = Math.min(cleaned.length, i + size);
    chunks.push(cleaned.slice(i, end));
    if (end >= cleaned.length) break;
    i = Math.max(i + 1, end - overlap);
  }
  return chunks;
}

export function mergeExtractBundles(parts: ExtractBundle[]): ExtractBundle {
  const events: ExtractedEvent[] = [];
  const entities: ExtractedRosterEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const eventKeys = new Set<string>();
  const entityKeys = new Set<string>();
  const relKeys = new Set<string>();
  const searchLocations: ExtractedSearchLocation[] = [];
  const contacts: ExtractedContactHint[] = [];
  let subject: ExtractedSubject | null = null;
  let lks: ExtractedLks | null = null;
  const locKeys = new Set<string>();
  const contactKeys = new Set<string>();
  for (const part of parts) {
    if (!subject && part.subject?.name) subject = part.subject;
    if (!lks && (part.lks?.location || part.lks?.date)) lks = part.lks ?? null;
    for (const ev of part.events) {
      const key = `${ev.title}|${ev.entityName}|${ev.timestampLabel}`.toLowerCase();
      if (eventKeys.has(key)) continue;
      eventKeys.add(key);
      events.push(ev);
    }
    for (const ent of part.entities) {
      const key = `${ent.name}|${ent.type}`.toLowerCase();
      if (entityKeys.has(key)) continue;
      entityKeys.add(key);
      entities.push(ent);
    }
    for (const rel of part.relationships) {
      const key = `${rel.sourceEntity}|${rel.targetEntity}|${rel.relationshipType}`.toLowerCase();
      if (relKeys.has(key)) continue;
      relKeys.add(key);
      relationships.push(rel);
    }
    for (const loc of part.searchLocations ?? []) {
      const key = `${loc.name}|${loc.type}`.toLowerCase();
      if (locKeys.has(key)) continue;
      locKeys.add(key);
      searchLocations.push(loc);
    }
    for (const c of part.contacts ?? []) {
      const key = c.name.toLowerCase();
      if (contactKeys.has(key)) continue;
      contactKeys.add(key);
      contacts.push(c);
    }
  }
  return { events, entities, relationships, subject, lks, searchLocations, contacts, warning: parts.find((p) => p.warning)?.warning };
}

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

export function coerceExtractBundle(body: Record<string, unknown>): ExtractBundle {
  const warning = typeof body.warning === "string" && body.warning.trim()
    ? body.warning
    : typeof body.error === "string" && String(body.engine || "") === "fallback"
      ? body.error
      : undefined;
  try {
    return { ...parseExtractBundle(JSON.stringify(body)), warning };
  } catch {
    const graph = parseExtractGraph(body);
    const rawEvents = Array.isArray(body.events) ? body.events : Array.isArray(body.items) ? body.items : [];
    const events = rawEvents.map(normalizeEvent).filter((e) => e.title.trim() || e.rawQuote.trim() || e.entityName.trim());
    return { events, entities: graph.entities, relationships: graph.relationships, warning };
  }
}

export function userExtractPrompt(
  text: string,
  fileName: string,
  entities: ExtractEntityHint[],
  opts?: { summary?: boolean; maxPages?: number; maxChars?: number },
) {
  const excerpt = prioritizeLegalFacts(text, opts?.maxChars ?? EXTRACT_MODEL_MAX_CHARS);
  return [
    `Source file: ${fileName}`,
    "OCR cleanup: correct obvious scanning typos, expand garbled place names, and keep incident dates separate from report dates.",
    opts?.summary
      ? "Mode: condensed summary of this excerpt only. Prefer fewer, high-confidence items."
      : "Mode: extract people, last-known locations, times, vehicles, physical evidence, and key narrative facts from this excerpt only (first pages / current window). Skip court boilerplate.",
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
    throw new Error(`Could not parse model JSON (${detail}).`);
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
