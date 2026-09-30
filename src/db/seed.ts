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
  { id: "ent-kestrel", caseId: "CASE-0041", name: "Route 112 crash site", type: "place", role: "last_seen", notes: "Last known sighting. Weathered crash, engine still running.", metadata: { locationKind: "last_seen", searchStatus: "Cleared", address: "Haverhill, NH", dateLogged: "2004-02-09" } },
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
  { id: "te-a1", caseId: "CASE-0038", entityId: "ent-webb", timestamp: atClock(20, 10), title: "Motel alibi", description: "Claims in Room 214 until 06:00", sourceDocId: "ev-report", isVerified: false },
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

export async function seedIfEmpty() {
  const count = await db.cases.count();
  if (count > 0) return;

  const seeded = await Promise.all(EVIDENCE.map(async (ev) => {
    const sha256Hash = await hashStoredEvidenceBytes(ev);
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
    const sha256Hash = row.sha256Hash || await hashStoredEvidenceBytes(row);
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
    await backfillEvidenceCustody();
  } catch (err) {
    console.error("[DB] evidence custody backfill failed", err);
  }
}
