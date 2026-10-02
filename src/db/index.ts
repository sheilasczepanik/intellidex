import type { EntityRelationship, SourceCitation, ExternalIntelLead, IntelClaim, IntelClaimCategory } from "../types";
import { storedEntityType } from "../types";
import { namesLooselyMatch, parseEventTime } from "../lib/eventTime";
import { classifySource } from "../lib/sourceTier";
import { mapContactAffiliation, normalizeAlertLevel } from "../lib/missingPerson";
import { isVictimOrDeceased } from "../utils/roleBadge";
import { isSearchNetworkPerson } from "../lib/personDirectory";
import { categoryAlreadyExists, customMediaCategoryId, sanitizeMediaCategoryLabel } from "../lib/mediaCategories";
import type { SubjectProfile } from "./schema";
import {
  db,
  DEFAULT_OPERATOR,
  OPERATOR_ID,
  type CaseContactRecord,
  type CaseMediaCategory,
  type CaseMediaRecord,
  type CaseMediaType,
  type CaseRecord,
  type CaseStatus,
  type EntityRecord,
  type EntityType,
  type ExtractCategory,
  type ThemePreference,
  type TimelineEventRecord,
  type UserProfile,
  type VerifyDraftRecord,
  type VerifyDraftStatus,
} from "./schema";

export * from "./schema";
export { initDb, seedIfEmpty, seedRelationshipsIfEmpty, ensureMm1Extractions } from "./seed";

export interface HubCase extends CaseRecord {
  entityCount: number;
  fileCount: number;
  pct: number;
}

export function formatTouched(ts: number) {
  const diff = Date.now() - ts;
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 21) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

export function statusToTone(status: string) {
  const s = status.toUpperCase();
  if (s === "CRITICAL_MEDICAL") return "fail" as const;
  if (s === "ENDANGERED_MISSING" || s === "REVIEW") return "review" as const;
  if (s === "ACTIVE_MISSING" || s === "ACTIVE" || s === "FIELD") return "active" as const;
  if (s === "COLD" || s === "ARCHIVED" || s === "CLOSED") return "cold" as const;
  if (s === "LOCATED") return "ok" as const;
  return "ok" as const;
}

export function isArchivedCase(c: { isArchived?: boolean; status?: string } | null | undefined) {
  if (!c) return false;
  return c.isArchived === true || String(c.status).toUpperCase() === "ARCHIVED";
}

export function isLocatedCase(c: { isArchived?: boolean; status?: string } | null | undefined) {
  if (!c || isArchivedCase(c)) return false;
  return String(c.status).toUpperCase() === "LOCATED";
}

export async function listHubCases(): Promise<HubCase[]> {
  const cases = await db.cases.orderBy("updatedAt").reverse().toArray();
  return Promise.all(
    cases.map(async (c) => {
      const entityCount = await db.entities.where("caseId").equals(c.id).count();
      const fileCount = await db.evidence.where("caseId").equals(c.id).count();
      const indexed = await db.evidence
        .where("caseId")
        .equals(c.id)
        .filter((e) => e.status === "indexed")
        .count();
      const pct = fileCount === 0 ? 0 : Math.round((indexed / fileCount) * 100);
      return { ...c, isArchived: c.isArchived === true, entityCount, fileCount, pct };
    }),
  );
}

async function nextCaseId() {
  const ids = new Set((await db.cases.toCollection().primaryKeys()).map((id) => String(id)));
  let stamp = Date.now();
  let id = `CASE-${stamp.toString().slice(-4)}`;
  while (ids.has(id)) {
    stamp += 1;
    id = `CASE-${stamp.toString().slice(-4)}`;
  }
  return id;
}

export async function createCase(input: {
  title: string;
  summary: string;
  status: CaseStatus;
  jurisdiction?: string;
  workingNotes?: string;
  incidentStart?: string;
  incidentEnd?: string;
  subjectName?: string;
  fileIdentifier?: string;
  lksAt?: string;
  lksLocation?: string;
  lksCircumstances?: string;
  subjectProfile?: SubjectProfile;
}) {
  const now = Date.now();
  const subjectName = (input.subjectName || input.title).trim();
  const row: CaseRecord = {
    id: await nextCaseId(),
    title: subjectName,
    summary: input.summary.trim(),
    status: normalizeAlertLevel(input.status) as CaseStatus,
    isArchived: false,
    archivedAt: undefined,
    createdAt: now,
    updatedAt: now,
    workingNotes: input.workingNotes ?? "",
    jurisdiction: input.jurisdiction ?? input.lksLocation ?? "",
    incidentStart: input.incidentStart ?? (input.lksAt ? input.lksAt.slice(0, 10) : ""),
    incidentEnd: input.incidentEnd ?? "",
    subjectName,
    fileIdentifier: (input.fileIdentifier || "").trim(),
    lksAt: input.lksAt ?? "",
    lksLocation: input.lksLocation ?? input.jurisdiction ?? "",
    lksCircumstances: input.lksCircumstances ?? "",
    subjectProfile: input.subjectProfile ?? {},
    pinnedPersonIds: [],
    customMediaCategories: [],
  };
  await db.cases.add(row);
  return row;
}

function lksMillis(value: string) {
  const raw = value.trim();
  if (!raw) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T12:00:00`).getTime();
  return Date.parse(raw);
}

/** Seed the chronology and map from a case's last known sighting, once per case. */
export async function ensureLastKnownSighting(caseRec: CaseRecord) {
  const where = (caseRec.lksLocation || "").trim();
  const whenRaw = (caseRec.lksAt || "").trim();
  const stamp = lksMillis(whenRaw);
  if (!Number.isFinite(stamp)) return null;
  const eventId = `lks-${caseRec.id}`;

  return db.transaction("rw", db.entities, db.timelineEvents, db.cases, async () => {
    const already = await db.timelineEvents.get(eventId);
    if (already) return already;
    const titled = await db.timelineEvents
      .where("caseId")
      .equals(caseRec.id)
      .filter((row) => /last known sighting/i.test(row.title))
      .first();
    if (titled) return titled;

    const entities = await db.entities.where("caseId").equals(caseRec.id).toArray();
    const subjectName = (caseRec.subjectName || caseRec.title || "").trim();
    let subject = entities.find((row) => row.type === "person" && subjectName && namesLooselyMatch(row.name, subjectName));
    if (!subject && subjectName) {
      subject = {
        id: crypto.randomUUID(),
        caseId: caseRec.id,
        name: subjectName,
        type: "person",
        role: "MISSING_PERSON",
        notes: "Case subject.",
        classification: "VERIFIED",
        identifiers: [],
        metadata: {},
        createdAt: new Date().toISOString(),
        provenanceTier: "primary",
        uncorroborated: false,
      };
      await db.entities.add(subject);
    }

    let place = where
      ? entities.find((row) => (row.type === "place" || row.type === "location") && namesLooselyMatch(row.name, where))
      : undefined;
    if (!place && where) {
      place = {
        id: crypto.randomUUID(),
        caseId: caseRec.id,
        name: where,
        type: "place",
        role: "last_seen",
        notes: "Last known sighting location.",
        classification: "VERIFIED",
        identifiers: [],
        metadata: { address: where, locationKind: "last_seen", searchStatus: "Cleared" },
        createdAt: new Date().toISOString(),
        provenanceTier: "primary",
        uncorroborated: false,
      };
      await db.entities.add(place);
    }

    const row: TimelineEventRecord = {
      id: eventId,
      caseId: caseRec.id,
      entityId: subject?.id || place?.id || "",
      timestamp: stamp,
      title: "Last Known Sighting (LKS)",
      description: where
        ? `Subject last seen in ${where}. Case record initial anchor.`
        : "Case record initial anchor.",
      sourceDocId: "",
      isVerified: true,
      confidenceTier: "TIER_1_VERIFIED",
      tier: "primary",
      origin: "manual",
      sourceCitation: {
        sourceId: "case-record",
        sourceName: "Case record (NamUs / Live alert)",
        sourceType: "text",
        exactQuote: caseRec.lksCircumstances || caseRec.summary || where,
      },
    };
    await db.timelineEvents.add(row);
    await db.cases.update(caseRec.id, { updatedAt: Date.now() });
    return row;
  });
}

export async function updateCase(
  id: string,
  patch: Partial<Pick<CaseRecord, "title" | "summary" | "status" | "workingNotes" | "jurisdiction" | "isArchived" | "archivedAt" | "locatedAt" | "incidentStart" | "incidentEnd" | "subjectName" | "fileIdentifier" | "lksAt" | "lksLocation" | "lksCircumstances" | "subjectProfile" | "pinnedPersonIds" | "customMediaCategories">>,
) {
  await db.cases.update(id, { ...patch, updatedAt: Date.now() });
}

export async function addCaseCustomMediaCategory(caseId: string, rawLabel: string) {
  const label = sanitizeMediaCategoryLabel(rawLabel);
  if (!label) throw new Error("Enter a category name.");
  const rec = await db.cases.get(caseId);
  const cur = rec?.customMediaCategories ?? [];
  if (categoryAlreadyExists(label, cur)) {
    const existing = cur.find((row) => customMediaCategoryId(row) === customMediaCategoryId(label)) || label;
    return { label: existing, id: customMediaCategoryId(existing) };
  }
  await db.cases.update(caseId, { customMediaCategories: [...cur, label], updatedAt: Date.now() });
  return { label, id: customMediaCategoryId(label) };
}

export async function renameCaseCustomMediaCategory(caseId: string, fromId: string, rawLabel: string) {
  const label = sanitizeMediaCategoryLabel(rawLabel);
  if (!label) throw new Error("Enter a category name.");
  const rec = await db.cases.get(caseId);
  const cur = rec?.customMediaCategories ?? [];
  const others = cur.filter((row) => customMediaCategoryId(row) !== fromId);
  if (categoryAlreadyExists(label, others)) throw new Error("That category already exists.");
  const next = cur.map((row) => (customMediaCategoryId(row) === fromId ? label : row));
  const toId = customMediaCategoryId(label);
  await db.cases.update(caseId, { customMediaCategories: next, updatedAt: Date.now() });
  if (toId !== fromId) {
    await db.caseMedia.where("caseId").equals(caseId).modify((row) => {
      if (row.category === fromId) row.category = toId;
    });
  }
  return { label, id: toId };
}

export async function removeCaseCustomMediaCategory(caseId: string, labelOrId: string) {
  const id = labelOrId.startsWith("custom:") ? labelOrId : customMediaCategoryId(labelOrId);
  const rec = await db.cases.get(caseId);
  const next = (rec?.customMediaCategories ?? []).filter((row) => customMediaCategoryId(row) !== id);
  await db.cases.update(caseId, { customMediaCategories: next, updatedAt: Date.now() });
  await db.caseMedia.where("caseId").equals(caseId).modify((row) => {
    if (row.category === id) row.category = "uncategorized";
  });
}

export async function togglePinnedPerson(caseId: string, personId: string, pinned?: boolean) {
  const rec = await db.cases.get(caseId);
  if (!rec) return;
  const cur = rec.pinnedPersonIds ?? [];
  const has = cur.includes(personId);
  const nextPinned = pinned ?? !has;
  const pinnedPersonIds = nextPinned
    ? [...new Set([...cur, personId])]
    : cur.filter((id) => id !== personId);
  await db.cases.update(caseId, { pinnedPersonIds, updatedAt: Date.now() });
}

export async function setCaseArchived(id: string, isArchived: boolean) {
  const now = Date.now();
  if (isArchived) {
    await db.cases.update(id, {
      isArchived: true,
      status: "ARCHIVED",
      archivedAt: new Date().toISOString(),
      updatedAt: now,
    });
    return;
  }
  await db.cases.update(id, {
    isArchived: false,
    archivedAt: "",
    status: "ACTIVE_MISSING",
    updatedAt: now,
  });
}

export async function touchCase(id: string) {
  await db.cases.update(id, { updatedAt: Date.now() });
}

export async function setCaseLocated(id: string) {
  await db.cases.update(id, {
    status: "LOCATED",
    isArchived: false,
    archivedAt: "",
    locatedAt: new Date().toISOString(),
    updatedAt: Date.now(),
  });
}

export async function reopenLocatedCase(id: string) {
  await db.cases.update(id, {
    status: "ACTIVE_MISSING",
    isArchived: false,
    locatedAt: "",
    updatedAt: Date.now(),
  });
}

export async function addCaseMedia(input: {
  caseId: string;
  dataUrl?: string;
  title: string;
  category: CaseMediaCategory;
  tags?: string[];
  sourceId?: string;
  originalFileName?: string;
  type?: CaseMediaType;
  thumbnailUrl?: string;
  sha256Hash?: string;
  sourceUrl?: string;
  description?: string;
  author?: string;
  faviconUrl?: string;
  summary?: string;
  mergedFrom?: string[];
}) {
  const type = input.type ?? (input.sourceUrl && !input.dataUrl ? "url" : (input.dataUrl || "").startsWith("data:application/pdf") ? "pdf" : "image");
  const row: CaseMediaRecord = {
    id: crypto.randomUUID(),
    caseId: input.caseId,
    dataUrl: input.dataUrl || "",
    title: input.title.trim() || "Untitled media",
    category: input.category,
    dateAdded: Date.now(),
    tags: input.tags ?? [],
    sourceId: input.sourceId,
    originalFileName: input.originalFileName,
    type,
    thumbnailUrl: input.thumbnailUrl || (type === "image" ? input.dataUrl : ""),
    sha256Hash: input.sha256Hash,
    sourceUrl: input.sourceUrl,
    description: input.description,
    author: input.author,
    faviconUrl: input.faviconUrl,
    summary: input.summary,
    mergedFrom: input.mergedFrom,
  };
  await db.caseMedia.add(row);
  await touchCase(input.caseId);
  return row;
}

export async function updateCaseMedia(
  id: string,
  patch: Partial<Pick<CaseMediaRecord, "title" | "category" | "tags" | "summary" | "description" | "mergedFrom" | "thumbnailUrl" | "author" | "isPinned">>,
) {
  await db.caseMedia.update(id, patch);
}

export async function deleteCaseMedia(id: string) {
  await db.caseMedia.delete(id);
}

export async function createEntity(input: {
  caseId: string;
  name: string;
  type: EntityType;
  role: string;
  notes: string;
  classification?: string;
  identifiers?: string[];
  metadata?: Record<string, string>;
  provenanceTier?: "primary" | "secondary";
  uncorroborated?: boolean;
}) {
  const row: EntityRecord = {
    id: crypto.randomUUID(),
    caseId: input.caseId,
    name: input.name.trim() || "Untitled",
    type: input.type,
    role: input.role,
    notes: input.notes.trim(),
    classification: input.classification || input.role || "UNVERIFIED",
    identifiers: input.identifiers ?? [],
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
    provenanceTier: input.provenanceTier ?? "primary",
    uncorroborated: input.uncorroborated ?? input.provenanceTier === "secondary",
  };
  await db.entities.add(row);
  await touchCase(input.caseId);
  return row;
}

export async function upsertEntityByName(input: {
  caseId: string;
  name: string;
  type: EntityType;
  role?: string;
  classification?: string;
  identifiers?: string[];
  notes?: string;
  metadata?: Record<string, string>;
  fromSecondary?: boolean;
}) {
  const name = input.name.trim();
  if (!name) return null;
  const roster = await db.entities.where("caseId").equals(input.caseId).toArray();
  const wanted = storedEntityType(input.type);
  const hit = roster.find((e) => {
    const nameMatch = namesLooselyMatch(e.name, name) || e.name.trim().toLowerCase() === name.toLowerCase();
    if (!nameMatch) return false;
    return storedEntityType(e.type) === wanted || storedEntityType(e.type) === "location" && wanted === "location";
  }) ?? roster.find((e) => namesLooselyMatch(e.name, name) || e.name.trim().toLowerCase() === name.toLowerCase());
  if (hit) {
    const identifiers = [...new Set([...(hit.identifiers ?? []), ...(input.identifiers ?? [])])];
    const patch: Partial<EntityRecord> = { identifiers };
    if (input.fromSecondary) {
      const note = input.notes?.trim();
      if (note && !(hit.notes || "").includes(note)) {
        patch.notes = [hit.notes, `Media (uncorroborated): ${note}`].filter(Boolean).join("\n");
      }
    } else {
      if (input.classification) patch.classification = input.classification;
      if (input.role) patch.role = input.role;
      patch.notes = input.notes && hit.notes && !hit.notes.includes(input.notes)
        ? [hit.notes, input.notes].filter(Boolean).join("\n")
        : (hit.notes || input.notes || "");
      patch.provenanceTier = "primary";
      patch.uncorroborated = false;
    }
    if (input.metadata) patch.metadata = { ...(hit.metadata ?? {}), ...input.metadata };
    await db.entities.update(hit.id, patch);
    return (await db.entities.get(hit.id)) ?? hit;
  }
  const mediaNote = input.notes?.trim()
    ? (input.fromSecondary ? `Media (uncorroborated): ${input.notes.trim()}` : input.notes)
    : "";
  return createEntity({
    caseId: input.caseId,
    name,
    type: wanted === "location" ? "place" : wanted,
    role: input.role || input.classification || "UNVERIFIED",
    classification: input.classification || input.role || "UNVERIFIED",
    identifiers: input.identifiers ?? [],
    notes: mediaNote,
    metadata: input.metadata ?? {},
    provenanceTier: input.fromSecondary ? "secondary" : "primary",
    uncorroborated: Boolean(input.fromSecondary),
  });
}

export async function promoteEntityToVerified(id: string) {
  const rec = await db.entities.get(id);
  if (!rec) return;
  await db.entities.update(id, {
    provenanceTier: "primary",
    uncorroborated: false,
  });
  await touchCase(rec.caseId);
}

export async function addRelationship(input: Omit<EntityRelationship, "id">) {
  if (!input.sourceEntityId || !input.targetEntityId || input.sourceEntityId === input.targetEntityId) return null;
  const existing = await db.relationships.where("caseId").equals(input.caseId).toArray();
  const dup = existing.find((e) => (
    e.sourceEntityId === input.sourceEntityId
    && e.targetEntityId === input.targetEntityId
    && e.relationshipType === input.relationshipType
  ));
  if (dup) {
    if (input.confidence > dup.confidence) {
      await db.relationships.update(dup.id, {
        label: input.label || dup.label,
        confidence: input.confidence,
        sourceCitationId: input.sourceCitationId || dup.sourceCitationId,
      });
    }
    return dup;
  }
  const row: EntityRelationship = { ...input, id: crypto.randomUUID() };
  await db.relationships.add(row);
  await touchCase(input.caseId);
  return row;
}

export async function listRelationships(caseId: string) {
  return db.relationships.where("caseId").equals(caseId).toArray();
}

export async function updateEntity(
  id: string,
  patch: Partial<Pick<EntityRecord, "name" | "type" | "role" | "notes" | "classification" | "metadata">>,
) {
  const rec = await db.entities.get(id);
  if (!rec) return;
  await db.entities.update(id, {
    name: patch.name != null ? (patch.name.trim() || rec.name) : rec.name,
    type: patch.type ?? rec.type,
    role: patch.role ?? rec.role,
    notes: patch.notes != null ? patch.notes.trim() : rec.notes,
    ...(patch.classification != null ? { classification: patch.classification } : {}),
    ...(patch.metadata ? { metadata: { ...(rec.metadata ?? {}), ...patch.metadata } } : {}),
  });
  await touchCase(rec.caseId);
}

export async function deleteEntity(id: string) {
  const rec = await db.entities.get(id);
  if (!rec) return;
  await db.transaction("rw", db.entities, db.timelineEvents, db.caseContacts, db.relationships, db.cases, async () => {
    await db.timelineEvents.where("entityId").equals(id).delete();
    const linked = await db.caseContacts.where("entityId").equals(id).toArray();
    await Promise.all(linked.map((c) => db.caseContacts.update(c.id, { entityId: "" })));
    const edges = await db.relationships.where("caseId").equals(rec.caseId).toArray();
    const drop = edges.filter((e) => e.sourceEntityId === id || e.targetEntityId === id).map((e) => e.id);
    if (drop.length) await db.relationships.bulkDelete(drop);
    await db.entities.delete(id);
    await db.cases.update(rec.caseId, { updatedAt: Date.now() });
  });
}

export async function createTimelineEvent(input: {
  caseId: string;
  entityId: string;
  timestamp: number;
  title: string;
  description: string;
  sourceDocId?: string;
  isVerified?: boolean;
  sourceCitation?: SourceCitation;
  tier?: "primary" | "secondary";
  origin?: "manual" | "ai";
  contentHash?: string;
  mergedFrom?: string[];
}) {
  const row: TimelineEventRecord = {
    id: crypto.randomUUID(),
    caseId: input.caseId,
    entityId: input.entityId,
    timestamp: input.timestamp,
    title: input.title.trim(),
    description: input.description.trim(),
    sourceDocId: input.sourceDocId ?? "",
    isVerified: input.isVerified ?? true,
    sourceCitation: input.sourceCitation,
    tier: input.tier ?? "primary",
    origin: input.origin,
    contentHash: input.contentHash,
    mergedFrom: input.mergedFrom,
  };
  await db.timelineEvents.add(row);
  await touchCase(input.caseId);
  return row;
}

export async function updateTimelineEvent(
  id: string,
  patch: Partial<Pick<TimelineEventRecord, "entityId" | "timestamp" | "title" | "description" | "isVerified" | "confidenceTier" | "timeEnd" | "latitude" | "longitude" | "flaggedNoise" | "tier">>,
) {
  const rec = await db.timelineEvents.get(id);
  if (!rec) return;
  await db.timelineEvents.update(id, patch);
  await touchCase(rec.caseId);
}

export async function deleteTimelineEvent(id: string) {
  const rec = await db.timelineEvents.get(id);
  if (!rec) return;
  await db.timelineEvents.delete(id);
  await touchCase(rec.caseId);
}

export async function addEvidence(input: {
  caseId: string;
  fileName: string;
  fileType: string;
  rawText: string;
  fileSize?: number;
  pageCount?: number;
  imageBase64?: string;
  fileBase64?: string;
  thumbnailDataUrl?: string;
  mediaType?: string;
  sha256Hash?: string;
  byteSize?: number;
  ingestedAt?: string;
  ingestedByCallsign?: string;
  originalFileName?: string;
  mimeType?: string;
  sourceType?: "pdf" | "image" | "text" | "web_article";
  sourceUrl?: string;
  publishedDate?: string;
  wordCount?: number;
  fullText?: string;
  fromPaste?: boolean;
  fromEditorial?: boolean;
}) {
  const fileName = input.fileName.trim() || "untitled.txt";
  const now = new Date().toISOString();
  const hash = (input.sha256Hash || "").trim();
  if (hash) {
    const existing = await db.evidence.where("caseId").equals(input.caseId).toArray();
    const hit = existing.find((row) => (row.sha256Hash || "").toLowerCase() === hash.toLowerCase());
    if (hit) return hit;
  }
  const classified = classifySource({
    fileName,
    originalFileName: input.originalFileName,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    fileType: input.fileType,
    fromWeb: input.sourceType === "web_article" || Boolean(input.sourceUrl),
    fromPaste: input.fromPaste,
    fromEditorial: input.fromEditorial,
  });
  const row = {
    id: crypto.randomUUID(),
    caseId: input.caseId,
    fileName,
    fileType: input.fileType || "txt",
    rawText: input.rawText,
    status: "ingesting" as const,
    fileSize: input.fileSize ?? input.byteSize,
    pageCount: input.pageCount,
    imageBase64: input.imageBase64,
    fileBase64: input.fileBase64,
    thumbnailDataUrl: input.thumbnailDataUrl,
    mediaType: input.mediaType ?? input.mimeType,
    sha256Hash: hash || input.sha256Hash || "",
    byteSize: input.byteSize ?? input.fileSize ?? 0,
    ingestedAt: input.ingestedAt ?? now,
    ingestedByCallsign: input.ingestedByCallsign ?? "",
    originalFileName: input.originalFileName ?? fileName,
    mimeType: input.mimeType ?? input.mediaType ?? input.fileType ?? "",
    sourceType: input.sourceType,
    sourceClass: classified.sourceClass,
    tier: classified.tier,
    sourceUrl: input.sourceUrl,
    publishedDate: input.publishedDate,
    wordCount: input.wordCount,
    fullText: input.fullText ?? input.rawText,
  };
  await db.evidence.add(row);
  await touchCase(input.caseId);
  return row;
}

export function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function deleteEvidence(id: string) {
  const rec = await db.evidence.get(id);
  if (!rec) return;
  await db.transaction("rw", db.evidence, db.verifyDrafts, db.cases, async () => {
    await db.verifyDrafts.where("evidenceId").equals(id).delete();
    await db.evidence.delete(id);
    await db.cases.update(rec.caseId, { updatedAt: Date.now() });
  });
}

const INTAKE_DONE_STATUSES = new Set(["indexed", "extracted", "completed"]);

export function isIntakeCompleteStatus(status?: string) {
  return INTAKE_DONE_STATUSES.has(String(status || "").toLowerCase());
}

/** Files that still need processing or operator attention in Intake. */
export function isPendingIntakeEvidence(row: { status?: string; stagingHidden?: boolean }) {
  if (row.stagingHidden) return false;
  const s = String(row.status || "").toLowerCase();
  if (isIntakeCompleteStatus(s)) return false;
  return s === "queued" || s === "processing" || s === "ingesting" || s === "flagged" || s === "failed";
}

export function isVisibleInStagingQueue(row: { stagingHidden?: boolean }) {
  return !row.stagingHidden;
}

export async function dismissEvidenceFromStaging(id: string) {
  const rec = await db.evidence.get(id);
  if (!rec) return;
  if (isIntakeCompleteStatus(rec.status)) {
    await db.evidence.update(id, { stagingHidden: true });
    await touchCase(rec.caseId);
    return;
  }
  await deleteEvidence(id);
}

export async function clearCompletedStaging(caseId: string) {
  const rows = await db.evidence.where("caseId").equals(caseId).toArray();
  const ids = rows.filter((row) => isIntakeCompleteStatus(row.status) && !row.stagingHidden).map((row) => row.id);
  if (!ids.length) return 0;
  await db.transaction("rw", db.evidence, db.cases, async () => {
    for (const id of ids) await db.evidence.update(id, { stagingHidden: true });
    await db.cases.update(caseId, { updatedAt: Date.now() });
  });
  return ids.length;
}

export { parseEventTime } from "../lib/eventTime";
export type { ParseEventTimeOpts } from "../lib/eventTime";

export async function addVerifyDrafts(
  drafts: (Omit<VerifyDraftRecord, "id" | "status"> & { id?: string; status?: VerifyDraftStatus })[],
  opts?: { replacePendingForEvidence?: string },
) {
  const rows: VerifyDraftRecord[] = drafts.map((d) => ({
    ...d,
    category: d.category || "",
    details: d.details || "",
    origin: d.origin ?? "ai",
    id: d.id || crypto.randomUUID(),
    status: d.status ?? "pending",
  }));
  await db.transaction("rw", db.verifyDrafts, db.evidence, db.cases, async () => {
    if (opts?.replacePendingForEvidence) {
      const existing = await db.verifyDrafts.where("evidenceId").equals(opts.replacePendingForEvidence).toArray();
      const stale = existing.filter((row) => row.status === "pending").map((row) => row.id);
      if (stale.length) await db.verifyDrafts.bulkDelete(stale);
    }
    if (rows.length) await db.verifyDrafts.bulkAdd(rows);
    const evidenceId = opts?.replacePendingForEvidence || drafts[0]?.evidenceId;
    if (evidenceId) {
      const rec = await db.evidence.get(evidenceId);
      if (rec) {
        await db.evidence.update(evidenceId, {
          status: rows.length ? "indexed" : "flagged",
          lastError: "",
        });
      }
    }
    if (drafts[0]) await touchCase(drafts[0].caseId);
  });
  return rows;
}

export type ManualEvidenceCategoryId =
  | "person"
  | "location"
  | "time"
  | "vehicle"
  | "evidence"
  | "subject_sighting"
  | "physical_description"
  | "timeline"
  | "contact";

const MANUAL_SPEC: Record<ManualEvidenceCategoryId, {
  label: string;
  entityType: EntityType;
  extract: ExtractCategory;
  role: string;
}> = {
  person: { label: "Person", entityType: "person", extract: "person", role: "UNVERIFIED" },
  location: { label: "Location", entityType: "place", extract: "location", role: "UNVERIFIED" },
  time: { label: "Time/Date", entityType: "person", extract: "time", role: "UNVERIFIED" },
  vehicle: { label: "Vehicle", entityType: "vehicle", extract: "vehicle", role: "UNVERIFIED" },
  evidence: { label: "Physical Evidence", entityType: "exhibit", extract: "evidence", role: "UNVERIFIED" },
  subject_sighting: { label: "Subject Sighting", entityType: "person", extract: "person", role: "UNVERIFIED" },
  physical_description: { label: "Physical Description", entityType: "person", extract: "physical_description", role: "UNVERIFIED" },
  timeline: { label: "Timeline Event", entityType: "person", extract: "time", role: "UNVERIFIED" },
  contact: { label: "Contact", entityType: "person", extract: "person", role: "WITNESS" },
};

export async function saveManualEvidence(input: {
  caseId: string;
  evidenceId: string;
  quote: string;
  notes: string;
  title?: string;
  category: ManualEvidenceCategoryId;
  pageNumber?: number;
  boundingBox?: SourceCitation["boundingBox"];
  previewDataUrl?: string;
  sourceName: string;
  sourceType: SourceCitation["sourceType"];
}) {
  const spec = MANUAL_SPEC[input.category];
  const quote = input.quote.replace(/\s+/g, " ").trim();
  const name = (input.title || quote).replace(/\s+/g, " ").trim().slice(0, 72) || spec.label;
  const notes = [input.notes.trim(), quote && `“${quote}”`].filter(Boolean).join("\n");
  const citation: SourceCitation = {
    sourceId: input.evidenceId,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    exactQuote: quote || name,
    pageNumber: input.pageNumber,
    boundingBox: input.boundingBox,
  };
  const entity = await createEntity({
    caseId: input.caseId,
    name,
    type: spec.entityType,
    role: spec.role,
    notes,
    classification: spec.role,
    metadata: {
      origin: "manual",
      observationCategory: spec.label,
      ...(input.previewDataUrl ? { visualSnippet: input.previewDataUrl } : {}),
      ...(input.boundingBox ? { bbox: JSON.stringify(input.boundingBox) } : {}),
      ...(input.pageNumber ? { pageNumber: String(input.pageNumber) } : {}),
      sourceId: input.evidenceId,
      ...(spec.entityType === "place" ? { locationKind: "last_seen", searchStatus: "Unchecked" } : {}),
    },
  });
  if (input.category === "contact") {
    await createCaseContact({
      caseId: input.caseId,
      name: entity.name,
      affiliation: mapContactAffiliation(spec.role, spec.role),
      entityId: entity.id,
      phone: "",
      email: "",
      address: "",
      notes,
    });
  }
  const drafts = await addVerifyDrafts([{
    caseId: input.caseId,
    evidenceId: input.evidenceId,
    timestamp: Date.now(),
    timestampLabel: input.pageNumber ? `Page ${input.pageNumber}` : "Manual extract",
    entityId: entity.id,
    entityName: entity.name,
    suggestNewEntity: false,
    newEntityType: spec.entityType,
    category: spec.extract,
    title: name,
    snippet: quote || name,
    details: input.notes.trim() || spec.label,
    confidence: 1,
    citation: "manual-observation",
    sourceCitation: citation,
    origin: "manual",
    status: "pending",
  }]);
  return { entity, draft: drafts[0] };
}

function intelEntityType(category: IntelClaimCategory): EntityType {
  if (category === "vehicle") return "vehicle";
  if (category === "location" || category === "sighting") return "location";
  if (category === "evidence") return "exhibit";
  return "person";
}

function intelExtractCategory(category: IntelClaimCategory): ExtractCategory {
  if (category === "alibi") return "time";
  if (category === "sighting") return "location";
  if (category === "person" || category === "vehicle" || category === "location" || category === "evidence") return category;
  return "evidence";
}

export async function addExternalIntelLead(lead: ExternalIntelLead) {
  await db.externalIntel.add(lead);
  await touchCase(lead.caseId);
  return lead;
}

export async function updateExternalIntelLead(id: string, patch: Partial<ExternalIntelLead>) {
  await db.externalIntel.update(id, patch);
}

export async function patchIntelClaim(leadId: string, claimId: string, patch: Partial<IntelClaim>) {
  const lead = await db.externalIntel.get(leadId);
  if (!lead) return;
  const claims = lead.claims.map((c) => (c.id === claimId ? { ...c, ...patch } : c));
  const pending = claims.some((c) => c.triageStatus === "pending");
  await db.externalIntel.update(leadId, {
    claims,
    status: pending ? "triaged" : lead.status === "archived" ? "archived" : "triaged",
  });
}

export async function promoteIntelClaimToVerify(lead: ExternalIntelLead, claim: IntelClaim) {
  const quote = claim.verbatimQuote.trim() || claim.claimText;
  const entityName = claim.claimText.replace(/\s+/g, " ").trim().slice(0, 80) || "Unnamed";
  await addVerifyDrafts([{
    caseId: lead.caseId,
    evidenceId: lead.id,
    timestamp: parseEventTime(claim.extractedTimestamp ?? null, claim.extractedTimestamp || "", {
      extraText: `${claim.claimText} ${claim.verbatimQuote}`,
    }),
    timestampLabel: claim.extractedTimestamp?.trim() || "Unknown",
    entityId: "",
    entityName,
    suggestNewEntity: true,
    newEntityType: intelEntityType(claim.category),
    category: intelExtractCategory(claim.category),
    title: claim.claimText.replace(/\s+/g, " ").trim().slice(0, 96) || "External intel claim",
    snippet: quote,
    details: `External intel · ${lead.title} · SHA-256 ${lead.sha256Hash}`,
    confidence: Math.min(1, Math.max(0, claim.confidence)),
    citation: `[${lead.title}: “${quote.slice(0, 72)}${quote.length > 72 ? "…" : ""}”]`,
    sourceCitation: {
      sourceId: lead.id,
      sourceName: lead.title,
      sourceType: "external_intel",
      exactQuote: quote,
      sourceUrl: lead.sourceUrl,
      sourceHash: lead.sha256Hash,
    },
  }]);
  await patchIntelClaim(lead.id, claim.id, { triageStatus: "promoted", promotedToVerifyQueue: true });
}

export async function updateVerifyDraft(
  id: string,
  patch: Partial<Pick<VerifyDraftRecord, "timestamp" | "timestampLabel" | "entityId" | "entityName" | "title" | "snippet" | "citation" | "details" | "category" | "newEntityType">>,
) {
  await db.verifyDrafts.update(id, patch);
}

export async function rejectVerifyDraft(id: string) {
  await db.verifyDrafts.update(id, { status: "rejected" });
}

export async function confirmVerifyDraft(id: string) {
  const draft = await db.verifyDrafts.get(id);
  if (!draft || draft.status !== "pending") return;

  const wantedType = draft.newEntityType || "person";
  const needle = draft.entityName.trim().toLowerCase();
  const roster = await db.entities.where("caseId").equals(draft.caseId).toArray();

  let entityId = draft.entityId && roster.some((e) => e.id === draft.entityId) ? draft.entityId : "";
  if (!entityId && draft.suggestNewEntity && needle) {
    const exact = roster.find((e) => e.name.trim().toLowerCase() === needle && (!wantedType || e.type === wantedType));
    const loose = roster.find((e) => {
      if (namesLooselyMatch(e.name, draft.entityName)) return true;
      const n = e.name.trim().toLowerCase();
      return n.includes(needle) || needle.includes(n);
    });
    entityId = exact?.id ?? loose?.id ?? "";
  }

  const source = draft.evidenceId ? await db.evidence.get(draft.evidenceId) : undefined;
  const secondary = source?.tier === "secondary"
    || source?.sourceClass === "news_article"
    || source?.sourceClass === "press_release"
    || source?.sourceType === "web_article";

  if (!entityId && draft.suggestNewEntity) {
    const created = await createEntity({
      caseId: draft.caseId,
      name: draft.entityName || "Unnamed",
      type: wantedType,
      role: "UNVERIFIED",
      notes: [draft.details, draft.snippet && `“${draft.snippet}”`, `Promoted from Verify · ${draft.category || "fact"}`]
        .filter(Boolean)
        .join("\n"),
      provenanceTier: secondary ? "secondary" : "primary",
      uncorroborated: secondary,
    });
    entityId = created.id;
  } else if (!secondary) {
    const existing = roster.find((e) => e.id === entityId);
    if (existing?.uncorroborated || existing?.provenanceTier === "secondary") {
      await db.entities.update(entityId, { provenanceTier: "primary", uncorroborated: false });
    }
  }

  await createTimelineEvent({
    caseId: draft.caseId,
    entityId,
    timestamp: parseEventTime(null, [draft.timestampLabel, draft.title, draft.details, draft.snippet, draft.citation].join(" "), {
      extraText: "",
      anchorMs: draft.timestamp || undefined,
    }),
    title: draft.title,
    description: [draft.details, draft.snippet && `“${draft.snippet}”`].filter(Boolean).join(" — "),
    sourceDocId: draft.evidenceId,
    isVerified: !secondary,
    sourceCitation: draft.sourceCitation,
    tier: secondary ? "secondary" : "primary",
  });
  await db.verifyDrafts.update(id, { status: "confirmed", entityId });
}

export async function createCaseContact(input: Omit<CaseContactRecord, "id" | "createdAt" | "updatedAt">) {
  const now = Date.now();
  const row: CaseContactRecord = {
    id: crypto.randomUUID(),
    caseId: input.caseId,
    name: input.name.trim() || "Untitled contact",
    affiliation: input.affiliation.trim() || "Other",
    entityId: input.entityId,
    phone: input.phone.trim(),
    email: input.email.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
    createdAt: now,
    updatedAt: now,
  };
  await db.caseContacts.add(row);
  await touchCase(input.caseId);
  return row;
}

export async function updateCaseContact(
  id: string,
  patch: Partial<Pick<CaseContactRecord, "name" | "affiliation" | "entityId" | "phone" | "email" | "address" | "notes">>,
) {
  const rec = await db.caseContacts.get(id);
  if (!rec) return;
  await db.caseContacts.update(id, { ...patch, updatedAt: Date.now() });
  await touchCase(rec.caseId);
}

export async function deleteCaseContact(id: string) {
  const rec = await db.caseContacts.get(id);
  if (!rec) return;
  await db.caseContacts.delete(id);
  await touchCase(rec.caseId);
}

const contactSyncs = new Map<string, Promise<void>>();

/** Mirror extracted people onto the rolodex so Overview contacts update without a review gate. */
export function ensureContactsForPeople(caseId: string) {
  const inflight = contactSyncs.get(caseId);
  if (inflight) return inflight;
  const job = syncContactsForPeople(caseId).finally(() => {
    if (contactSyncs.get(caseId) === job) contactSyncs.delete(caseId);
  });
  contactSyncs.set(caseId, job);
  return job;
}

async function syncContactsForPeople(caseId: string) {
  const people = (await db.entities.where("caseId").equals(caseId).toArray())
    .filter((e) => isSearchNetworkPerson(e) && !isVictimOrDeceased(e.role, e.notes, e.classification));
  const contacts = await db.caseContacts.where("caseId").equals(caseId).toArray();
  const seenEntity = new Set<string>();
  const seenName = new Set<string>();
  for (const contact of contacts) {
    const key = contact.name.trim().toLowerCase();
    const duplicate = (contact.entityId && seenEntity.has(contact.entityId)) || seenName.has(key);
    if (duplicate) {
      await db.caseContacts.delete(contact.id);
      continue;
    }
    if (contact.entityId) seenEntity.add(contact.entityId);
    if (key) seenName.add(key);
  }
  for (const person of people) {
    const key = person.name.trim().toLowerCase();
    if (seenEntity.has(person.id) || seenName.has(key)) continue;
    await createCaseContact({
      caseId,
      name: person.name,
      affiliation: mapContactAffiliation(person.role || "", person.classification),
      entityId: person.id,
      phone: "",
      email: "",
      address: "",
      notes: person.notes || "",
    });
    seenEntity.add(person.id);
    seenName.add(key);
  }
}

export function computeAvatarInitials(firstName: string, lastName: string) {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  if (a && b) return `${a}${b}`.toUpperCase();
  const compact = `${firstName}${lastName}`.replace(/\s+/g, "");
  return compact.slice(0, 2).toUpperCase() || "CR";
}

export function namesFromCreator(creatorName: string) {
  const parts = creatorName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: DEFAULT_OPERATOR.firstName, lastName: DEFAULT_OPERATOR.lastName };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function hydrateUserProfile(row?: Partial<UserProfile> | null): UserProfile {
  const merged = { ...DEFAULT_OPERATOR, ...row };
  const creatorName = (
    merged.creatorName
    || `${merged.firstName || ""} ${merged.lastName || ""}`.trim()
    || merged.callsign
    || DEFAULT_OPERATOR.creatorName
  ).trim();
  const names = namesFromCreator(creatorName);
  return {
    ...DEFAULT_OPERATOR,
    ...merged,
    creatorName,
    showTitle: merged.showTitle ?? merged.agency ?? DEFAULT_OPERATOR.showTitle,
    firstName: merged.firstName?.trim() || names.firstName,
    lastName: merged.lastName?.trim() || names.lastName,
    role: merged.role?.trim() || DEFAULT_OPERATOR.role,
    callsign: merged.callsign || "",
    badgeNumber: merged.badgeNumber || "",
    agency: merged.agency || merged.showTitle || "",
    avatarInitials: (merged.avatarInitials?.trim() || computeAvatarInitials(names.firstName, names.lastName)).slice(0, 3),
    permissions: { ...DEFAULT_OPERATOR.permissions, ...merged.permissions },
  };
}

export function defaultCallsign(firstName: string, lastName: string) {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first && !last) return "CREATOR";
  const initial = first ? `${first.charAt(0).toUpperCase()}. ` : "";
  return `${initial}${last.toUpperCase()}`.trim();
}

export async function getOperatorProfile() {
  const row = await db.userProfile.get(OPERATOR_ID);
  return hydrateUserProfile(row);
}

export async function saveOperatorProfile(input: Omit<UserProfile, "id" | "updatedAt"> & { id?: string }) {
  const names = namesFromCreator(input.creatorName || `${input.firstName} ${input.lastName}`);
  const initials = input.avatarInitials.trim().toUpperCase()
    || computeAvatarInitials(names.firstName, names.lastName);
  const creatorName = (input.creatorName || `${names.firstName} ${names.lastName}`).trim() || DEFAULT_OPERATOR.creatorName;
  const showTitle = (input.showTitle ?? input.agency ?? "").trim();
  const row: UserProfile = {
    ...input,
    id: OPERATOR_ID,
    creatorName,
    showTitle,
    firstName: names.firstName,
    lastName: names.lastName,
    callsign: input.callsign?.trim() || defaultCallsign(names.firstName, names.lastName),
    role: input.role.trim() || DEFAULT_OPERATOR.role,
    badgeNumber: input.badgeNumber?.trim() || "",
    agency: showTitle,
    avatarInitials: initials.slice(0, 3),
    themePreference: input.themePreference,
    permissions: input.permissions,
    updatedAt: new Date().toISOString(),
  };
  await db.userProfile.put(row);
  return row;
}

export async function resetLocalVault() {
  await db.delete();
  try {
    localStorage.removeItem("dossier.apiKey");
    localStorage.removeItem("dossier.provider");
  } catch { /* ignore */ }
}

export function applyThemePreference(pref: ThemePreference) {
  const dark = pref === "dark"
    || (pref === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);
}
