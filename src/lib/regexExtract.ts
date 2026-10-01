import type { ExtractBundle, ExtractedEvent, ExtractedRosterEntity } from "./extractSchema";

const NAME_STOP = new Set([
  "the", "this", "that", "plaintiff", "defendant", "court", "county", "state", "united", "states",
  "exhibit", "appendix", "section", "article", "january", "february", "march", "april", "may",
  "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday",
]);

function eventFrom(title: string, entityName: string, timestampLabel: string, quote: string, category: ExtractedEvent["category"]): ExtractedEvent {
  return {
    timestamp: timestampLabel || null,
    timestampLabel: timestampLabel || "Unknown",
    entityId: null,
    entityName,
    entityType: category === "vehicle" ? "vehicle" : category === "location" ? "place" : "person",
    suggestNewEntity: true,
    newEntityType: category === "vehicle" ? "vehicle" : category === "location" ? "place" : "person",
    category,
    title,
    snippet: quote,
    rawQuote: quote,
    details: title,
    confidence: 0.35,
    citation: "regex-fallback",
    exactQuote: quote.slice(0, 180),
  };
}

/** Last-resort extractor so a failed Claude parse still yields names, dates, and addresses. */
export function regexExtractFromText(text: string, fileName: string): ExtractBundle {
  const source = text.slice(0, 80_000);
  const entities: ExtractedRosterEntity[] = [];
  const events: ExtractedEvent[] = [];
  const seen = new Set<string>();

  const pushEntity = (name: string, type: ExtractedRosterEntity["type"], classification: string) => {
    const key = name.toLowerCase();
    if (seen.has(key) || name.length < 4) return;
    seen.add(key);
    entities.push({ name, type, classification, identifiers: [] });
  };

  for (const match of source.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,3})\b/g)) {
    const name = match[1].trim();
    const parts = name.split(/\s+/);
    if (parts.some((p) => NAME_STOP.has(p.toLowerCase()))) continue;
    pushEntity(name, "person", "UNVERIFIED");
  }

  for (const match of source.matchAll(/\b(\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Place|Pl))\b/gi)) {
    const addr = match[1].replace(/\s+/g, " ").trim();
    pushEntity(addr, "place", "REGISTERED");
    events.push(eventFrom(`Address cited · ${addr}`, addr, "", match[0], "location"));
  }

  for (const match of source.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)) {
    const date = match[1];
    const around = source.slice(Math.max(0, match.index! - 80), Math.min(source.length, match.index! + 120)).replace(/\s+/g, " ").trim();
    const person = entities[0]?.name || fileName.replace(/\.[^.]+$/, "");
    events.push(eventFrom(`Dated fact · ${date}`, person, date, around, "time"));
  }

  if (!entities.length) {
    pushEntity(fileName.replace(/\.[^.]+$/, "") || "Unnamed source", "exhibit", "UNVERIFIED");
  }
  if (!events.length && entities[0]) {
    events.push(eventFrom(`Facts indexed from ${fileName}`, entities[0].name, "", source.slice(0, 180), "evidence"));
  }

  return { events: events.slice(0, 20), entities: entities.slice(0, 24), relationships: [] };
}

/** Guaranteed cards so Verify is usable when the extract API is down. */
export function sampleExtractedCards(fileName: string): ExtractBundle {
  return metadataPlaceholderCards(fileName, "");
}

/** Structured placeholders from filename / sparse OCR (call numbers, agencies, report dates). */
export function metadataPlaceholderCards(fileName: string, text = ""): ExtractBundle {
  const hay = `${fileName}\n${text}`.slice(0, 20_000);
  const label = fileName.replace(/\.[^.]+$/, "") || "Source file";
  const call = hay.match(/\b(\d{2,4}[-–]\d{3,6})\b/);
  const dept = hay.match(/\b([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,4}\s+(?:Police|PD|Sheriff|Department|Dept)\.?)\b/);
  const date = hay.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
  const events: ExtractedEvent[] = [];
  const entities: ExtractedRosterEntity[] = [];
  if (call) {
    events.push(eventFrom(`Call / case number ${call[1]}`, dept?.[1] || label, date?.[1] || "Unknown", call[0], "evidence"));
    entities.push({ name: call[1], type: "exhibit", classification: "UNVERIFIED", identifiers: [call[1]] });
  }
  if (dept) {
    events.push(eventFrom(`Reporting agency · ${dept[1]}`, dept[1], date?.[1] || "Unknown", dept[0], "person"));
    entities.push({ name: dept[1], type: "person", classification: "UNVERIFIED", identifiers: [] });
  }
  if (date) {
    events.push(eventFrom(`Incident / report date ${date[1]}`, label, date[1], date[0], "time"));
  }
  if (!events.length) {
    events.push(eventFrom(`Indexed source · ${label}`, label, "Unknown", `Placeholder card from ${fileName}. Highlight text in the viewer to add facts.`, "evidence"));
  }
  if (!entities.length) {
    entities.push({ name: label, type: "exhibit", classification: "UNVERIFIED", identifiers: [] });
  }
  return { events: events.slice(0, 8), entities: entities.slice(0, 8), relationships: [] };
}
