import type { ExtractBundle, ExtractCategory, ExtractedEvent } from "../lib/extractSchema";
import type { EntityType, SourceCitation } from "../types";
import type { VerifyDraftRecord } from "../db/schema";

export type Mm1Extraction = {
  id: string;
  category: "WITNESS_STATEMENT" | "OFFICIAL_ACTION" | "TIMELINE_EVENT" | "EVIDENCE";
  type: string;
  sourceId: string;
  pageNumber: number;
  title: string;
  timestamp: string;
  details: string;
  exactSnippet: string;
  confidence: number;
  status: "UNRESOLVED";
};

/** Findings taken from the 38-page MM 1 supplemental report. */
export const MM_1_EXTRACTIONS: Mm1Extraction[] = [
  {
    id: "mm1-1",
    category: "WITNESS_STATEMENT",
    type: "Statement",
    sourceId: "MM 1",
    pageNumber: 11,
    title: "Nursing Student Interview: Returned Clothes",
    timestamp: "2004-02-09T13:30:00",
    details: "Nursing classmate reported Maura returned borrowed clothes on Monday 2/9/04, placed outside door at 354 Patterson Dorm. Classmate noted Maura was quiet, reserved, and a good student.",
    exactSnippet: "returned borrowed clothes to her sometime Monday 2/9/04. The clothes were placed on the floor in the hallway outside door at 354 Patterson Dorm",
    confidence: 0.98,
    status: "UNRESOLVED",
  },
  {
    id: "mm1-2",
    category: "OFFICIAL_ACTION",
    type: "Action",
    sourceId: "MM 1",
    pageNumber: 11,
    title: "Dormitory Well-Being Check & Belongings Packed",
    timestamp: "2004-02-11T09:45:00",
    details: "Det. Davies and Ofc. Roberts entered Room 415 Kennedy Dorm. Observed all personal belongings packed into boxes and bags as if occupant was prepared to move out. Photographs taken.",
    exactSnippet: "the personal belongings in the room were packed as if the occupant was prepared to move out of the dorm. I photographed the room using a Sony digital camera",
    confidence: 0.99,
    status: "UNRESOLVED",
  },
  {
    id: "mm1-3",
    category: "TIMELINE_EVENT",
    type: "Movement",
    sourceId: "MM 1",
    pageNumber: 12,
    title: "Forensic PC Seizure & 20-Mile Grid Search",
    timestamp: "2004-02-12T08:00:00",
    details: "Chief Williams of Haverhill reported a 20-mile search grid around the accident scene yielded no trace. UMPD seized Maura's desktop computer tower for digital forensic examination.",
    exactSnippet: "He stated a 20 mile grid search of the area around where Maura had the car accident did not reveal any information.",
    confidence: 0.95,
    status: "UNRESOLVED",
  },
  {
    id: "mm1-4",
    category: "EVIDENCE",
    type: "Physical Evidence",
    sourceId: "MM 1",
    pageNumber: 13,
    title: "Rag Recovered from Saturn Tailpipe",
    timestamp: "2004-02-09T19:46:00",
    details: "Examination of the 1996 Saturn SL2 revealed an unexplained rag stuffed firmly into the exhaust tailpipe. Vehicle contained unopened sleeping aids and aspirin.",
    exactSnippet: "There was a rag stuffed in the tailpipe which is unexplained. There were two bottles of asprin and two boxes of over the counter sleeping aids - all unopened.",
    confidence: 0.99,
    status: "UNRESOLVED",
  },
  {
    id: "mm1-5",
    category: "TIMELINE_EVENT",
    type: "Financial",
    sourceId: "MM 1",
    pageNumber: 24,
    title: "ATM Surveillance Footage: $280 Withdrawal",
    timestamp: "2004-02-09T15:15:00",
    details: "Fleet Bank security footage at 195 University Drive confirmed Maura alone withdrawing $280 cash between 15:14:58 and 15:16:29, exiting toward parking area.",
    exactSnippet: "entered the ATM terminal/cash box at 195 University Drive- by herself. No vehicle information was available. There are two ATM terminals",
    confidence: 0.98,
    status: "UNRESOLVED",
  },
  {
    id: "mm1-6",
    category: "WITNESS_STATEMENT",
    type: "Statement",
    sourceId: "MM 1",
    pageNumber: 35,
    title: "Supervisor Incident: Melville Desk Breakdown",
    timestamp: "2004-02-05T01:20:00",
    details: "Security supervisor found Maura crying at Melville Hall security desk after an upsetting phone call, repeating 'It's my sister not me'. Supervised walk to Kennedy Dorm.",
    exactSnippet: "Maura Murray was visibly upset in Melville after receiving a phone call while on shift. I asked them the nature of the phone call, and they said that Maura was too upset to talk about it.",
    confidence: 0.97,
    status: "UNRESOLVED",
  },
  {
    id: "mm1-7",
    category: "TIMELINE_EVENT",
    type: "Accident",
    sourceId: "MM 1",
    pageNumber: 12,
    title: "Prior Collision on Route 9 in Hadley",
    timestamp: "2004-02-08T03:33:00",
    details: "Accident report by Ofc. Ruddock confirms Maura crashed Fred Murray's vehicle in Hadley, MA. Towed by College Street Motors to Hadley Quality Inn.",
    exactSnippet: "Received accident report written by Ofc. Ruddock after 02/08/04 03:33 accident. The vehicle was towed by College Street Motors to the Hadley Quality Inn",
    confidence: 0.96,
    status: "UNRESOLVED",
  },
];

const MM1_ROSTER: Record<string, { name: string; type: EntityType; suggest: boolean }> = {
  "mm1-1": { name: "Nursing classmate", type: "person", suggest: true },
  "mm1-2": { name: "Det. Davies", type: "person", suggest: true },
  "mm1-3": { name: "Chief Williams", type: "person", suggest: true },
  "mm1-4": { name: "Rag in tailpipe", type: "exhibit", suggest: true },
  "mm1-5": { name: "Maura Murray", type: "person", suggest: false },
  "mm1-6": { name: "Security supervisor", type: "person", suggest: true },
  "mm1-7": { name: "Ofc. Ruddock", type: "person", suggest: true },
};

export function isMm1Source(fileName = "", sourceId = "") {
  const hay = `${fileName} ${sourceId}`.trim();
  return /(?:^|[^A-Za-z0-9])MM[_\s-]?1(?:[^A-Za-z0-9]|$)/i.test(hay);
}

function draftCategory(category: Mm1Extraction["category"]): ExtractCategory {
  if (category === "EVIDENCE") return "evidence";
  if (category === "TIMELINE_EVENT") return "time";
  return "communication";
}

export function mm1ReportText() {
  const byPage = new Map<number, string[]>();
  for (const row of MM_1_EXTRACTIONS) {
    const list = byPage.get(row.pageNumber) ?? [];
    list.push(row.exactSnippet);
    byPage.set(row.pageNumber, list);
  }
  const pages: string[] = [];
  for (let page = 1; page <= 38; page += 1) {
    const body = byPage.get(page) ?? [`Supplemental report page ${page}. No additional narrative extracted on this page.`];
    pages.push(`--- Page ${page} ---\nHaverhill Police Department supplemental report MM 1, page ${page}.\n\n${body.join("\n\n")}`);
  }
  return pages.join("\n\n");
}

export function reportPages(text: string) {
  const parts = text.split(/(?=---\s*PAGE\s+\d+\s*---)/i).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => {
    const match = part.match(/---\s*PAGE\s+(\d+)\s*---/i);
    const page = match ? Number(match[1]) : 1;
    const body = part.replace(/---\s*PAGE\s+\d+\s*---/i, "").trim();
    return { page, body };
  });
}

export function mm1DraftRows(caseId: string, evidenceId: string, fileName: string): VerifyDraftRecord[] {
  return MM_1_EXTRACTIONS.map((item) => {
    const person = MM1_ROSTER[item.id];
    const citation: SourceCitation = {
      sourceId: evidenceId,
      sourceName: fileName,
      sourceType: "pdf",
      pageNumber: item.pageNumber,
      exactQuote: item.exactSnippet,
    };
    return {
      id: item.id,
      caseId,
      evidenceId,
      timestamp: Date.parse(item.timestamp),
      timestampLabel: item.timestamp.replace("T", " "),
      entityId: "",
      entityName: person?.name || "",
      suggestNewEntity: Boolean(person?.suggest),
      newEntityType: person?.suggest ? person.type : "",
      category: draftCategory(item.category),
      title: item.title,
      snippet: item.exactSnippet,
      details: item.details,
      confidence: item.confidence,
      citation: "mm1-fixture",
      origin: "ai",
      status: "pending",
      sourceCitation: citation,
    };
  });
}

export function mm1ExtractBundle(): ExtractBundle {
  const events: ExtractedEvent[] = MM_1_EXTRACTIONS.map((row) => {
    const roster = MM1_ROSTER[row.id];
    const category = draftCategory(row.category);
    return {
      timestamp: row.timestamp,
      timestampLabel: row.timestamp.replace("T", " "),
      entityId: null,
      entityName: roster?.name || "",
      entityType: roster?.type || "person",
      suggestNewEntity: Boolean(roster?.suggest),
      newEntityType: roster?.suggest ? roster.type : null,
      category,
      title: row.title,
      snippet: row.exactSnippet,
      rawQuote: row.exactSnippet,
      details: row.details,
      confidence: row.confidence,
      citation: "mm1-fixture",
      pageNumber: row.pageNumber,
      exactQuote: row.exactSnippet,
      tier: "primary",
    };
  });
  const entities = events
    .filter((event) => event.suggestNewEntity && event.entityName)
    .map((event) => ({
      name: event.entityName,
      type: event.entityType,
      classification: event.entityType === "person" ? "UNVERIFIED" : "EVIDENCE",
      identifiers: [] as string[],
      contextSnippet: event.exactQuote,
    }));
  return { events, entities, relationships: [] };
}
