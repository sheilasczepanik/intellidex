import {
  db,
  DEFAULT_OPERATOR,
  OPERATOR_ID,
  type CaseRecord,
  type EntityRecord,
  type EvidenceRecord,
  type TimelineEventRecord,
} from "./schema";
import type { EntityRelationship } from "../types";
import { hashStoredEvidenceBytes } from "../lib/cryptoUtils";
import { PLACEHOLDER_CCTV_STILL } from "../lib/placeholderStills";
import { isMm1Source, MM_1_EXTRACTIONS, mm1DraftRows, mm1ReportText } from "../data/caseFixtures";

const hour = 60 * 60 * 1000;
const day = 24 * hour;

function at(offsetMs: number) {
  return Date.now() - offsetMs;
}

const CASES: CaseRecord[] = [
  {
    id: "CASE-0041",
    title: "Maura Murray",
    subjectName: "Maura Murray",
    fileIdentifier: "MP-2004-01",
    summary: "Last seen after a crash on Route 112 in Haverhill, New Hampshire. Search workspace for official records, tips, and grid logs.",
    status: "ENDANGERED_MISSING",
    isArchived: false,
    createdAt: at(40 * day),
    updatedAt: at(2 * hour),
    workingNotes: "",
    jurisdiction: "Haverhill, Grafton County, NH",
    lksLocation: "Haverhill, Grafton County, NH",
    lksAt: "2004-02-09T19:27",
    incidentStart: "2004-02-09",
    incidentEnd: "",
    subjectProfile: {
      ageAtDisappearance: "21",
      currentEstimatedAge: "43",
      height: "5'3\"",
      weight: "120 lbs",
      hair: "Brown",
      eyes: "Blue",
      distinguishingMarks: "Scar on right knee",
      clothingLastSeen: "Dark coat, jeans",
      medicalAlerts: "",
    },
  },
  {
    id: "CASE-0038",
    title: "Meridian Freight",
    summary: "Falsified manifests tied to a fleet of nine vehicles registered to a single address.",
    status: "CRITICAL_MEDICAL",
    isArchived: false,
    createdAt: at(28 * day),
    updatedAt: at(26 * hour),
    workingNotes: "Motel alibi for Webb conflicts with the Gate 4 toll. Vance reconstructed from badge, card, and camera.",
    jurisdiction: "Precinct 4 / municipal docks",
  },
  {
    id: "CASE-0031",
    title: "Blackwell Estate",
    summary: "Dormant since the probate filings surfaced. Two witnesses still unreachable.",
    status: "COLD",
    isArchived: false,
    createdAt: at(90 * day),
    updatedAt: at(21 * day),
    workingNotes: "",
    jurisdiction: "Probate court",
  },
];

const ENTITIES: EntityRecord[] = [
  { id: "ent-okonkwo", caseId: "CASE-0038", name: "Dana Okonkwo", type: "person", role: "SUSPECT", notes: "Director, Meridian Freight. Seen at Dock 4 twice this week." },
  { id: "ent-webb", caseId: "CASE-0038", name: "Marcus Webb", type: "person", role: "WITNESS", notes: "Motel alibi under review — conflicts with toll record." },
  { id: "ent-vance", caseId: "CASE-0038", name: "Julian Vance", type: "person", role: "person_of_interest", notes: "Director, Meridian Freight. Movements reconstructed from badge, card and camera records." },
  { id: "ent-pier9", caseId: "CASE-0038", name: "Pier 9 Bonded Warehouse", type: "place", role: "last_seen", notes: "Dock road, east quay. Gate unsecured on last two visits.", metadata: { locationKind: "last_seen", searchStatus: "Active Search" } },
  { id: "ent-motel", caseId: "CASE-0038", name: "Blue Heron Motel", type: "place", role: "search_grid", notes: "42 mi south of Gate 4. Desk unstaffed 21:00–06:00.", metadata: { locationKind: "search_grid", searchStatus: "Unchecked" } },
  { id: "ent-volvo", caseId: "CASE-0038", name: "Volvo FH16 — 4211-XK", type: "vehicle", role: "TRACKED", notes: "19 ANPR hits. Registered to Meridian Freight." },
  { id: "ent-sedan", caseId: "CASE-0038", name: "Grey sedan", type: "vehicle", role: "UNVERIFIED", notes: "Partial plate from two CCTV stills." },

  { id: "ent-maura", caseId: "CASE-0041", name: "Maura Murray", type: "person", role: "MISSING_PERSON", notes: "Nursing student. Last seen after a crash on Route 112." },
  { id: "ent-brennan", caseId: "CASE-0041", name: "A. Brennan", type: "person", role: "UNVERIFIED", notes: "Name appears in 14 documents, identity not confirmed." },
  { id: "ent-sund", caseId: "CASE-0041", name: "Halvard Sund", type: "person", role: "ASSOCIATE", notes: "Named on two shell registrations." },
  { id: "ent-kestrel", caseId: "CASE-0041", name: "Route 112 crash site", type: "place", role: "last_seen", notes: "Last known sighting. Weathered crash, engine still running.", metadata: { locationKind: "last_seen", searchStatus: "Cleared", address: "Haverhill, NH", dateLogged: "2004-02-09", coordinates: "44.1186, -71.9362" } },
  { id: "ent-bayc", caseId: "CASE-0041", name: "Woods east of Weathered Corner", type: "place", role: "search_grid", notes: "Ground search grids and trail canvass.", metadata: { locationKind: "search_grid", searchStatus: "Active Search" } },

  { id: "ent-blackwell", caseId: "CASE-0031", name: "Eleanor Blackwell", type: "person", role: "SUSPECT", notes: "Deceased. Estate still in probate." },
  { id: "ent-witness-a", caseId: "CASE-0031", name: "Witness A", type: "person", role: "WITNESS", notes: "Unreachable since the probate filings surfaced." },
  { id: "ent-witness-b", caseId: "CASE-0031", name: "Witness B", type: "person", role: "WITNESS", notes: "Unreachable since the probate filings surfaced." },
  { id: "ent-estate", caseId: "CASE-0031", name: "Blackwell House", type: "place", role: "PRIMARY", notes: "Primary estate property under freeze." },
];

const EVIDENCE: EvidenceRecord[] = [
  { id: "ev-manifest", caseId: "CASE-0041", fileName: "manifest_batch_2024Q3.pdf", fileType: "pdf", rawText: "412 pages of bonded warehouse manifests. OCR complete.", status: "indexed" },
  { id: "ev-wires", caseId: "CASE-0041", fileName: "wire_transfers_export.csv", fileType: "csv", rawText: "8,902 rows of shell-company transfers across three port authorities.", status: "ingesting" },
  { id: "ev-mbox", caseId: "CASE-0041", fileName: "okonkwo_mailbox.mbox", fileType: "mail", rawText: "Queued mailbox export.", status: "queued" },
  { id: "ev-cctv", caseId: "CASE-0038", fileName: "cctv_pier9_0214.jpg", fileType: "image", rawText: "EXIF timestamp mismatch on Pier 9 still.", status: "flagged", imageBase64: PLACEHOLDER_CCTV_STILL, sourceType: "image" },
  { id: "ev-interview", caseId: "CASE-0038", fileName: "interview_vlas_02.m4a", fileType: "audio", rawText: "47:12 interview. Transcript pending.", status: "ingesting" },
  { id: "ev-report", caseId: "CASE-0038", fileName: "incident_report_24-8813.pdf", fileType: "pdf", rawText: "Supplementary narrative — night of 14 February. Precinct 4, Ofc. D. Reyes.", status: "indexed" },
  { id: "ev-probate", caseId: "CASE-0031", fileName: "probate_filings_bundle.pdf", fileType: "pdf", rawText: "Probate filings for the Blackwell estate.", status: "indexed" },
];

const atClock = (h: number, m: number) => new Date(2024, 1, 14, h, m).getTime();

const TIMELINE: TimelineEventRecord[] = [
  { id: "te-e1", caseId: "CASE-0038", entityId: "ent-vance", timestamp: atClock(18, 40), title: "Leaves office, Kestrel Row", description: "Door log, west entrance", sourceDocId: "ev-report", isVerified: true },
  { id: "te-e2", caseId: "CASE-0038", entityId: "ent-vance", timestamp: atClock(19, 15), title: "Fuel stop, Route 9", description: "Debit authorisation 41.20", sourceDocId: "ev-report", isVerified: true },
  { id: "te-a1", caseId: "CASE-0038", entityId: "ent-webb", timestamp: atClock(20, 10), timeEnd: "06:00", confidenceTier: "TIER_2_UNVERIFIED", title: "Motel alibi", description: "Civilian tip: claims in Room 214 until 06:00", sourceDocId: "ev-report", isVerified: false },
  { id: "te-t2", caseId: "CASE-0038", entityId: "ent-volvo", timestamp: atClock(20, 51), title: "Toll Booth Exit — Gate 4", description: "Northbound plate read", sourceDocId: "ev-cctv", isVerified: true },
  { id: "te-t3", caseId: "CASE-0038", entityId: "ent-volvo", timestamp: atClock(20, 58), title: "Ping 42 mi north", description: "Tower NB-207", sourceDocId: "ev-report", isVerified: true },
];

const RELATIONSHIPS: EntityRelationship[] = [
  { id: "rel-okonkwo-volvo", caseId: "CASE-0038", sourceEntityId: "ent-okonkwo", targetEntityId: "ent-volvo", relationshipType: "registered_owner", label: "Registered Owner", confidence: 0.92, sourceCitationId: "ev-report" },
  { id: "rel-vance-volvo", caseId: "CASE-0038", sourceEntityId: "ent-vance", targetEntityId: "ent-volvo", relationshipType: "operator_driver", label: "Observed driving", confidence: 0.8, sourceCitationId: "ev-cctv" },
  { id: "rel-webb-motel", caseId: "CASE-0038", sourceEntityId: "ent-webb", targetEntityId: "ent-motel", relationshipType: "residence", label: "Checked into Room 214", confidence: 0.86, sourceCitationId: "ev-report" },
  { id: "rel-vance-pier", caseId: "CASE-0038", sourceEntityId: "ent-vance", targetEntityId: "ent-pier9", relationshipType: "last_known_location", label: "Last seen Dock 4", confidence: 0.7, sourceCitationId: "ev-cctv" },
  { id: "rel-okonkwo-pier", caseId: "CASE-0038", sourceEntityId: "ent-okonkwo", targetEntityId: "ent-pier9", relationshipType: "crime_scene", label: "Crime scene link", confidence: 0.78, sourceCitationId: "ev-report" },
  { id: "rel-vance-webb", caseId: "CASE-0038", sourceEntityId: "ent-vance", targetEntityId: "ent-webb", relationshipType: "associate_of", label: "Associate of", confidence: 0.55, sourceCitationId: "ev-report" },
];

async function custodyHash(row: { fileBase64?: string; imageBase64?: string; rawText?: string; fileName?: string }) {
  try {
    return await hashStoredEvidenceBytes(row);
  } catch (err) {
    console.warn("[seed] Stored bytes could not be hashed; hashing the text record instead.", err);
    return hashStoredEvidenceBytes({ rawText: row.rawText || row.fileName || "" });
  }
}

export async function seedIfEmpty() {
  const count = await db.cases.count();
  if (count > 0) return;

  const seeded = await Promise.all(EVIDENCE.map(async (ev) => {
    const sha256Hash = await custodyHash(ev);
    return {
      ...ev,
      sha256Hash,
      byteSize: ev.fileSize ?? new TextEncoder().encode(ev.rawText).length,
      ingestedAt: new Date(Date.now() - 3 * day).toISOString(),
      ingestedByCallsign: DEFAULT_OPERATOR.creatorName,
      originalFileName: ev.fileName,
      mimeType: ev.fileType === "pdf" ? "application/pdf" : ev.fileType === "image" ? "image/jpeg" : `application/${ev.fileType}`,
    };
  }));

  await db.transaction("rw", db.cases, db.entities, db.evidence, db.timelineEvents, db.relationships, async () => {
    await db.cases.bulkAdd(CASES);
    await db.entities.bulkAdd(ENTITIES);
    await db.evidence.bulkAdd(seeded);
    await db.timelineEvents.bulkAdd(TIMELINE);
    await db.relationships.bulkAdd(RELATIONSHIPS);
  });
}

export async function seedRelationshipsIfEmpty() {
  try {
    const n = await db.relationships.count();
    if (n > 0) return;
    const sample = await db.entities.get("ent-vance");
    if (!sample) return;
    await db.relationships.bulkAdd(RELATIONSHIPS);
  } catch (err) {
    console.error("[DB] relationship seed failed", err);
  }
}

export async function seedOperatorIfMissing() {
  const existing = await db.userProfile.get(OPERATOR_ID);
  if (existing) return;
  await db.userProfile.put({
    ...DEFAULT_OPERATOR,
    updatedAt: new Date().toISOString(),
  });
}

export async function backfillEvidenceCustody() {
  const rows = await db.evidence.toArray();
  const op = await db.userProfile.get(OPERATOR_ID);
  const callsign = op?.creatorName || op?.callsign || DEFAULT_OPERATOR.creatorName;
  for (const row of rows) {
    if (row.sha256Hash && row.ingestedAt && row.originalFileName) continue;
    const sha256Hash = row.sha256Hash || await custodyHash(row);
    await db.evidence.update(row.id, {
      sha256Hash,
      byteSize: row.byteSize ?? row.fileSize ?? new TextEncoder().encode(row.rawText || "").length,
      ingestedAt: row.ingestedAt || new Date().toISOString(),
      ingestedByCallsign: row.ingestedByCallsign || callsign,
      originalFileName: row.originalFileName || row.fileName,
      mimeType: row.mimeType || row.mediaType || row.fileType,
    });
  }
}

let mm1Queue: Promise<void> = Promise.resolve();

/** Put MM_1.pdf and the full MM_1_EXTRACTIONS set on the case. A short pending queue is replaced. */
export function ensureMm1Extractions(opts?: { force?: boolean; caseId?: string }) {
  const job = mm1Queue.then(() => writeMm1Extractions(opts));
  mm1Queue = job.then(() => undefined, () => undefined);
  return job;
}

async function writeMm1Extractions(opts?: { force?: boolean; caseId?: string }) {
  const caseId = opts?.caseId || "CASE-0041";
  const caseRow = await db.cases.get(caseId);
  if (!caseRow) return;
  const evidence = await db.evidence.where("caseId").equals(caseId).toArray();
  let row = evidence.find((item) => isMm1Source(item.fileName));
  const transcript = mm1ReportText();
  if (!row) {
    row = {
      id: "ev-mm1",
      caseId,
      fileName: "MM_1.pdf",
      originalFileName: "MM_1.pdf",
      fileType: "pdf",
      mediaType: "application/pdf",
      mimeType: "application/pdf",
      sourceType: "pdf",
      sourceClass: "police_report",
      tier: "primary",
      rawText: transcript,
      fullText: transcript,
      pageCount: 38,
      wordCount: transcript.split(/\s+/).filter(Boolean).length,
      status: "indexed",
      lastError: "",
    };
    await db.evidence.add(row);
  } else if (!row.fileBase64 && !(row.fullText || row.rawText || "").includes("It's my sister not me")) {
    await db.evidence.update(row.id, {
      rawText: transcript,
      fullText: transcript,
      pageCount: row.pageCount || 38,
      status: "indexed",
      lastError: "",
    });
  }
  const existing = await db.verifyDrafts.where("evidenceId").equals(row.id).toArray();
  const fixtureIds = new Set(MM_1_EXTRACTIONS.map((item) => item.id));
  const pending = existing.filter((draft) => draft.status === "pending" && draft.origin !== "manual" && draft.citation !== "manual-observation");
  const fixturePending = pending.filter((draft) => fixtureIds.has(draft.id) || draft.citation === "mm1-fixture");
  const stale = pending.filter((draft) => !fixtureIds.has(draft.id) && draft.citation !== "mm1-fixture");
  const short = fixturePending.length < 5;
  const storedIds = new Set(existing.map((draft) => draft.id));
  const missing = MM_1_EXTRACTIONS.some((item) => !storedIds.has(item.id));
  if (!opts?.force && !short && stale.length === 0 && !missing) return;
  const drop = [
    ...stale.map((draft) => draft.id),
    ...((opts?.force || short) ? fixturePending.map((draft) => draft.id) : []),
  ];
  if (drop.length) await db.verifyDrafts.bulkDelete([...new Set(drop)]);
  const have = new Set((await db.verifyDrafts.where("evidenceId").equals(row.id).toArray()).map((draft) => draft.id));
  const rows = mm1DraftRows(caseId, row.id, row.fileName)
    .map((draft) => (caseId === "CASE-0041" ? draft : { ...draft, id: `${caseId}__${draft.id}` }))
    .filter((draft) => !have.has(draft.id));
  if (rows.length) await db.verifyDrafts.bulkAdd(rows);
}

function isMauraMurrayCase(row: { subjectName?: string; title?: string }) {
  return /maura murray/i.test(`${row.subjectName || ""} ${row.title || ""}`);
}

function isBiographicalTimelineEvent(event: { title: string; description?: string }) {
  return /\b(date of birth|birthday|\bdob\b|\bborn\b)/i.test(`${event.title} ${event.description || ""}`);
}

/** Attach the MM 1 chronology to a Maura Murray case that does not already have one. */
export async function ensureMauraChronology(caseId?: string) {
  const cases = caseId
    ? [await db.cases.get(caseId)].filter((row): row is CaseRecord => Boolean(row))
    : await db.cases.toArray();
  for (const row of cases) {
    if (!isMauraMurrayCase(row)) continue;
    await writeMauraChronology(row.id);
  }
}

async function writeMauraChronology(caseId: string) {
  const events = await db.timelineEvents.where("caseId").equals(caseId).toArray();
  const chronology = events.filter((event) => !isBiographicalTimelineEvent(event));
  if (chronology.length > 1) return;

  const evidence = await db.evidence.where("caseId").equals(caseId).toArray();
  let doc = evidence.find((item) => isMm1Source(item.fileName, item.id));
  const transcript = mm1ReportText();
  if (!doc) {
    doc = {
      id: `ev-mm1-${caseId}`,
      caseId,
      fileName: "MM_1.pdf",
      originalFileName: "MM_1.pdf",
      fileType: "pdf",
      mediaType: "application/pdf",
      mimeType: "application/pdf",
      sourceType: "pdf",
      sourceClass: "police_report",
      tier: "primary",
      rawText: transcript,
      fullText: transcript,
      pageCount: 38,
      wordCount: transcript.split(/\s+/).filter(Boolean).length,
      status: "indexed",
      lastError: "",
    };
    await db.evidence.add(doc);
  }

  const titles = new Set(events.map((event) => event.title));
  const ids = new Set(events.map((event) => event.id));
  const timelineRows: TimelineEventRecord[] = MM_1_EXTRACTIONS
    .map((item) => ({
      id: `${caseId}__${item.id}`,
      caseId,
      entityId: "",
      timestamp: Date.parse(item.timestamp),
      title: item.title,
      description: [item.details, item.exactSnippet].filter(Boolean).join("\n"),
      sourceDocId: doc.id,
      isVerified: false,
      origin: "ai" as const,
      tier: "primary" as const,
      confidenceTier: "TIER_2_UNVERIFIED" as const,
      sourceCitation: {
        sourceId: doc.id,
        sourceName: doc.fileName,
        sourceType: "pdf" as const,
        pageNumber: item.pageNumber,
        exactQuote: item.exactSnippet,
      },
    }))
    .filter((event) => !ids.has(event.id) && !titles.has(event.title) && Number.isFinite(event.timestamp));
  if (timelineRows.length) await db.timelineEvents.bulkAdd(timelineRows);

  const drafts = mm1DraftRows(caseId, doc.id, doc.fileName).map((draft) => ({
    ...draft,
    id: `${caseId}__${draft.id}`,
  }));
  const stored = await db.verifyDrafts.where("caseId").equals(caseId).toArray();
  const storedIds = new Set(stored.map((draft) => draft.id));
  const storedTitles = new Set(stored.map((draft) => draft.title));
  const missingDrafts = drafts.filter((draft) => !storedIds.has(draft.id) && !storedTitles.has(draft.title));
  if (missingDrafts.length) await db.verifyDrafts.bulkAdd(missingDrafts);
}

export async function initDb() {
  await db.open();
  await seedIfEmpty();
  try {
    await seedRelationshipsIfEmpty();
  } catch (err) {
    console.error("[DB] relationships seed failed", err);
  }
  try {
    await seedOperatorIfMissing();
  } catch (err) {
    console.error("[DB] operator profile seed failed", err);
  }
  try {
    await ensureMm1Extractions();
    await ensureMauraChronology();
  } catch (err) {
    console.error("[DB] MM 1 extraction seed failed", err);
  }
  try {
    await backfillEvidenceCustody();
  } catch (err) {
    console.error("[DB] evidence custody backfill failed", err);
  }
}
