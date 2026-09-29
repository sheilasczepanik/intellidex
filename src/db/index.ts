import type { EntityRelationship, SourceCitation, ExternalIntelLead, IntelClaim, IntelClaimCategory } from "../types";
import { storedEntityType } from "../types";
import { namesLooselyMatch, parseEventTime } from "../lib/eventTime";
import {
  db,
  DEFAULT_OPERATOR,
  OPERATOR_ID,
  type CaseContactRecord,
  type CaseRecord,
  type CaseStatus,
  type EntityRecord,
  type EntityType,
  type ExtractCategory,
  type ThemePreference,
  type TimelineEventRecord,
  type UserProfile,
  type VerifyDraftRecord,
} from "./schema";

export * from "./schema";
export { initDb, seedIfEmpty, seedRelationshipsIfEmpty } from "./seed";

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
  if (s === "ACTIVE" || s === "FIELD") return "active" as const;
  if (s === "REVIEW") return "review" as const;
  if (s === "COLD" || s === "ARCHIVED" || s === "CLOSED") return "cold" as const;
  return "ok" as const;
}

export function isArchivedCase(c: { isArchived?: boolean; status?: string } | null | undefined) {
  if (!c) return false;
  return c.isArchived === true || String(c.status).toUpperCase() === "ARCHIVED";
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
  const ids = await db.cases.toCollection().primaryKeys();
  const nums = ids
    .map((id) => Number.parseInt(String(id).replace(/\D/g, ""), 10))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `CASE-${String(next).padStart(4, "0")}`;
}

export async function createCase(input: {
  title: string;
  summary: string;
  status: CaseStatus;
  jurisdiction?: string;
  workingNotes?: string;
}) {
  const now = Date.now();
  const row: CaseRecord = {
    id: await nextCaseId(),
    title: input.title.trim(),
    summary: input.summary.trim(),
    status: input.status,
    isArchived: false,
    archivedAt: undefined,
    createdAt: now,
    updatedAt: now,
    workingNotes: input.workingNotes ?? "",
    jurisdiction: input.jurisdiction ?? "",
  };
  await db.cases.add(row);
  return row;
}

export async function updateCase(
  id: string,
  patch: Partial<Pick<CaseRecord, "title" | "summary" | "status" | "workingNotes" | "jurisdiction" | "isArchived" | "archivedAt">>,
) {
  await db.cases.update(id, { ...patch, updatedAt: Date.now() });
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
    status: "ACTIVE",
    updatedAt: now,
  });
}

export async function touchCase(id: string) {
  await db.cases.update(id, { updatedAt: Date.now() });
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
    await db.entities.update(hit.id, {
      identifiers,
      classification: input.classification || hit.classification || hit.role,
      notes: input.notes && hit.notes && !hit.notes.includes(input.notes)
        ? [hit.notes, input.notes].filter(Boolean).join("\n")
        : (hit.notes || input.notes || ""),
    });
    return (await db.entities.get(hit.id)) ?? hit;
  }
  return createEntity({
    caseId: input.caseId,
    name,
    type: wanted === "location" ? "place" : wanted,
    role: input.role || input.classification || "UNVERIFIED",
    classification: input.classification || input.role || "UNVERIFIED",
    identifiers: input.identifiers ?? [],
    notes: input.notes ?? "",
  });
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
  patch: Pick<EntityRecord, "name" | "type" | "role" | "notes">,
) {
  const rec = await db.entities.get(id);
  if (!rec) return;
  await db.entities.update(id, {
    name: patch.name.trim() || rec.name,
    type: patch.type,
    role: patch.role,
    notes: patch.notes.trim(),
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
  };
  await db.timelineEvents.add(row);
  await touchCase(input.caseId);
  return row;
}

export async function updateTimelineEvent(
  id: string,
  patch: Partial<Pick<TimelineEventRecord, "entityId" | "timestamp" | "title" | "description" | "isVerified">>,
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
}) {
  const fileName = input.fileName.trim() || "untitled.txt";
  const now = new Date().toISOString();
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
    sha256Hash: input.sha256Hash ?? "",
    byteSize: input.byteSize ?? input.fileSize ?? 0,
    ingestedAt: input.ingestedAt ?? now,
    ingestedByCallsign: input.ingestedByCallsign ?? "",
    originalFileName: input.originalFileName ?? fileName,
    mimeType: input.mimeType ?? input.mediaType ?? input.fileType ?? "",
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    publishedDate: input.publishedDate,
    wordCount: input.wordCount,
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

export { parseEventTime } from "../lib/eventTime";
export type { ParseEventTimeOpts } from "../lib/eventTime";

export async function addVerifyDrafts(
  drafts: Omit<VerifyDraftRecord, "id" | "status">[],
  opts?: { replacePendingForEvidence?: string },
) {
  const rows: VerifyDraftRecord[] = drafts.map((d) => ({
    ...d,
    category: d.category || "",
    details: d.details || "",
    id: crypto.randomUUID(),
    status: "pending",
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
          lastError: rows.length ? "" : "Claude returned no items. Try a shorter excerpt or paste narrative text.",
        });
      }
    }
    if (drafts[0]) await touchCase(drafts[0].caseId);
  });
  return rows;
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
  if (!entityId && needle) {
    const exact = roster.find((e) => e.name.trim().toLowerCase() === needle && (!wantedType || e.type === wantedType));
    const loose = roster.find((e) => {
      if (namesLooselyMatch(e.name, draft.entityName)) return true;
      const n = e.name.trim().toLowerCase();
      return n.includes(needle) || needle.includes(n);
    });
    entityId = exact?.id ?? loose?.id ?? "";
  }

  if (!entityId) {
    const created = await createEntity({
      caseId: draft.caseId,
      name: draft.entityName || "Unnamed",
      type: wantedType,
      role: "UNVERIFIED",
      notes: [draft.details, draft.snippet && `“${draft.snippet}”`, `Promoted from Verify · ${draft.category || "fact"}`]
        .filter(Boolean)
        .join("\n"),
    });
    entityId = created.id;
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
    isVerified: true,
    sourceCitation: draft.sourceCitation,
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
