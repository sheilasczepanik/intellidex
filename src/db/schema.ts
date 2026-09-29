import Dexie, { type EntityTable } from "dexie";
import type { SourceCitation, EntityType, EntityRelationship, ExternalIntelLead, IntelClaim } from "../types";

export type { EntityType, EntityRelationship, ExternalIntelLead, IntelClaim };
export type { SourceCitation } from "../types";

export type CaseStatus = "ACTIVE" | "REVIEW" | "COLD" | "FIELD" | "ARCHIVED" | "CLOSED";
export type EvidenceStatus = "indexed" | "ingesting" | "flagged" | "queued" | "failed";

export interface CaseRecord {
  id: string;
  title: string;
  summary: string;
  status: CaseStatus;
  isArchived: boolean;
  archivedAt?: string;
  createdAt: number;
  updatedAt: number;
  workingNotes?: string;
  jurisdiction?: string;
  incidentStart?: string;
  incidentEnd?: string;
}

export interface EntityRecord {
  id: string;
  caseId: string;
  name: string;
  type: EntityType;
  role: string;
  notes: string;
  classification?: string;
  identifiers?: string[];
  metadata?: Record<string, string>;
  createdAt?: string;
  /** Official (primary) vs media intelligence (secondary). */
  provenanceTier?: "primary" | "secondary";
  uncorroborated?: boolean;
}

export interface EvidenceRecord {
  id: string;
  caseId: string;
  fileName: string;
  fileType: string;
  rawText: string;
  status: EvidenceStatus;
  fileSize?: number;
  pageCount?: number;
  lastError?: string;
  textClarity?: "ok" | "low";
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
  /** Taxonomy requested as sourceType in the product spec (media format remains pdf|image|text|web_article). */
  sourceClass?: "affidavit" | "police_report" | "forensic_record" | "news_article" | "press_release" | "note";
  tier?: "primary" | "secondary";
  sourceUrl?: string;
  publishedDate?: string;
  wordCount?: number;
}

export interface TimelineEventRecord {
  id: string;
  caseId: string;
  entityId: string;
  timestamp: number;
  title: string;
  description: string;
  sourceDocId: string;
  isVerified: boolean;
  sourceCitation?: SourceCitation;
  tier?: "primary" | "secondary";
}

export type VerifyDraftStatus = "pending" | "confirmed" | "rejected";

export type ExtractCategory =
  | "person"
  | "location"
  | "vehicle"
  | "telecom"
  | "time"
  | "evidence"
  | "communication"
  | "time_window"
  | "physical_description"
  | "";

export interface VerifyDraftRecord {
  id: string;
  caseId: string;
  evidenceId: string;
  timestamp: number;
  timestampLabel: string;
  entityId: string;
  entityName: string;
  suggestNewEntity: boolean;
  newEntityType: EntityType | "";
  category: ExtractCategory;
  title: string;
  snippet: string;
  details: string;
  confidence: number;
  citation: string;
  sourceCitation?: SourceCitation;
  status: VerifyDraftStatus;
}

export const CONTACT_AFFILIATIONS = [
  "Victim Family / Next of Kin",
  "Property Owner / Business Manager",
  "Lead Detective",
  "Legal Counsel",
  "Witness",
  "Other",
] as const;

export type ContactAffiliation = (typeof CONTACT_AFFILIATIONS)[number] | string;

export interface CaseContactRecord {
  id: string;
  caseId: string;
  name: string;
  affiliation: string;
  entityId: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export const OPERATOR_ID = "current-operator";

export const OPERATOR_ROLES = [
  "Host",
  "Producer",
  "Investigative Journalist",
  "Lead Researcher",
  "Guest Reviewer",
] as const;

export type OperatorRole = (typeof OPERATOR_ROLES)[number] | string;
export type ThemePreference = "system" | "dark" | "light";

export interface OperatorPermissions {
  canDeleteEvidence: boolean;
  canExportDossier: boolean;
  canOverrideContradictions: boolean;
  canManageTeam: boolean;
}

export interface UserProfile {
  id: string;
  creatorName: string;
  showTitle: string;
  firstName: string;
  lastName: string;
  callsign: string;
  role: string;
  badgeNumber: string;
  agency: string;
  avatarInitials: string;
  permissions: OperatorPermissions;
  themePreference: ThemePreference;
  updatedAt: string;
}

export const DEFAULT_OPERATOR: UserProfile = {
  id: OPERATOR_ID,
  creatorName: "Rachel Vance",
  showTitle: "True Crime Briefing",
  firstName: "Rachel",
  lastName: "Vance",
  callsign: "R. VANCE",
  role: "Host",
  badgeNumber: "",
  agency: "",
  avatarInitials: "RV",
  permissions: {
    canDeleteEvidence: true,
    canExportDossier: true,
    canOverrideContradictions: true,
    canManageTeam: true,
  },
  themePreference: "system",
  updatedAt: new Date(0).toISOString(),
};

export class DossierDB extends Dexie {
  cases!: EntityTable<CaseRecord, "id">;
  entities!: EntityTable<EntityRecord, "id">;
  evidence!: EntityTable<EvidenceRecord, "id">;
  timelineEvents!: EntityTable<TimelineEventRecord, "id">;
  verifyDrafts!: EntityTable<VerifyDraftRecord, "id">;
  caseContacts!: EntityTable<CaseContactRecord, "id">;
  userProfile!: EntityTable<UserProfile, "id">;
  relationships!: EntityTable<EntityRelationship, "id">;
  externalIntel!: EntityTable<ExternalIntelLead, "id">;

  constructor() {
    super("DossierDB");
    this.version(1).stores({
      cases: "id, status, updatedAt",
      entities: "id, caseId, type, name",
      evidence: "id, caseId, status, fileType",
      timelineEvents: "id, caseId, entityId, timestamp, sourceDocId, isVerified",
    });
    this.version(2).stores({
      verifyDrafts: "id, caseId, evidenceId, status, [caseId+status]",
    });
    this.version(3).stores({
      cases: "id, status, updatedAt",
      entities: "id, caseId, type, name",
      evidence: "id, caseId, status, fileType",
      timelineEvents: "id, caseId, entityId, timestamp, sourceDocId, isVerified",
      verifyDrafts: "id, caseId, evidenceId, status, [caseId+status]",
    });
    this.version(4).stores({
      caseContacts: "id, caseId, entityId, name, [caseId+updatedAt]",
    });
    this.version(5).stores({
      cases: "id, status, updatedAt, isArchived",
    }).upgrade(async (tx) => {
      await tx.table("cases").toCollection().modify((row: { isArchived?: boolean }) => {
        if (typeof row.isArchived !== "boolean") row.isArchived = false;
      });
    });
    this.version(6).stores({
      userProfile: "id",
    });
    this.version(7).stores({
      evidence: "id, caseId, status, fileType",
    });
    this.version(8).stores({
      evidence: "id, caseId, status, fileType",
      timelineEvents: "id, caseId, entityId, timestamp, sourceDocId, isVerified",
      verifyDrafts: "id, caseId, evidenceId, status, [caseId+status]",
    });
    this.version(9).stores({
      entities: "id, caseId, type, name",
      relationships: "id, caseId, sourceEntityId, targetEntityId, relationshipType, [caseId+sourceEntityId], [caseId+targetEntityId]",
    }).upgrade(async (tx) => {
      await tx.table("entities").toCollection().modify((row: {
        identifiers?: string[];
        metadata?: Record<string, string>;
        createdAt?: string;
        classification?: string;
        role?: string;
      }) => {
        if (!Array.isArray(row.identifiers)) row.identifiers = [];
        if (!row.metadata || typeof row.metadata !== "object") row.metadata = {};
        if (!row.createdAt) row.createdAt = new Date().toISOString();
        if (!row.classification) row.classification = row.role || "UNVERIFIED";
      });
    });
    this.version(10).stores({
      evidence: "id, caseId, status, fileType, sha256Hash",
    }).upgrade(async (tx) => {
      await tx.table("evidence").toCollection().modify((row: {
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        mediaType?: string;
        sha256Hash?: string;
        byteSize?: number;
        ingestedAt?: string;
        ingestedByCallsign?: string;
        originalFileName?: string;
        mimeType?: string;
      }) => {
        if (!row.originalFileName) row.originalFileName = row.fileName || "untitled";
        if (row.byteSize == null) row.byteSize = row.fileSize ?? 0;
        if (!row.mimeType) row.mimeType = row.mediaType || row.fileType || "";
        if (!row.ingestedAt) row.ingestedAt = new Date().toISOString();
        if (!row.ingestedByCallsign) row.ingestedByCallsign = "";
        if (!row.sha256Hash) row.sha256Hash = "";
      });
    });
    this.version(11).stores({
      evidence: "id, caseId, status, fileType, sha256Hash, sourceType",
    });
    this.version(12).stores({
      cases: "id, status, updatedAt, isArchived",
    }).upgrade(async (tx) => {
      await tx.table("cases").toCollection().modify((row: {
        isArchived?: boolean;
        archivedAt?: string;
        status?: string;
      }) => {
        if (typeof row.isArchived !== "boolean") row.isArchived = false;
        if (row.isArchived) {
          if (!row.archivedAt) row.archivedAt = new Date().toISOString();
          row.status = "ARCHIVED";
        }
      });
    });
    this.version(13).stores({
      externalIntel: "id, caseId, status, createdAt",
    });
    this.version(14).stores({
      userProfile: "id",
    }).upgrade(async (tx) => {
      await tx.table("userProfile").toCollection().modify((row: {
        firstName?: string;
        lastName?: string;
        callsign?: string;
        agency?: string;
        creatorName?: string;
        showTitle?: string;
        role?: string;
      }) => {
        if (!row.creatorName?.trim()) {
          row.creatorName = `${row.firstName || ""} ${row.lastName || ""}`.trim() || row.callsign || "Rachel Vance";
        }
        if (row.showTitle == null) row.showTitle = row.agency || "";
        if (!row.role?.trim()) row.role = "Host";
      });
    });
    this.version(15).stores({
      cases: "id, status, updatedAt, isArchived",
    });
    this.version(16).stores({
      evidence: "id, caseId, status, fileType, sha256Hash, sourceType, tier",
    }).upgrade(async (tx) => {
      await tx.table("evidence").toCollection().modify((row: {
        fileName?: string;
        originalFileName?: string;
        sourceType?: string;
        sourceUrl?: string;
        fileType?: string;
        tier?: string;
        sourceClass?: string;
      }) => {
        const web = row.sourceType === "web_article" || row.fileType === "web_article" || Boolean(row.sourceUrl);
        if (!row.tier) row.tier = web ? "secondary" : "primary";
        if (!row.sourceClass) {
          const blob = `${row.fileName || ""} ${row.originalFileName || ""}`.toLowerCase();
          if (web) row.sourceClass = /press|newswire|bulletin/.test(`${blob} ${row.sourceUrl || ""}`) ? "press_release" : "news_article";
          else if (/affidavit|warrant/.test(blob)) row.sourceClass = "affidavit";
          else if (/forensic|autopsy|ballistic/.test(blob)) row.sourceClass = "forensic_record";
          else if (/\.(txt|md|csv|json|log)$/.test(blob) && !blob.includes(".pdf")) row.sourceClass = "note";
          else row.sourceClass = "police_report";
        }
      });
      await tx.table("entities").toCollection().modify((row: {
        provenanceTier?: string;
        uncorroborated?: boolean;
      }) => {
        if (!row.provenanceTier) row.provenanceTier = "primary";
        if (typeof row.uncorroborated !== "boolean") row.uncorroborated = false;
      });
      const evidence = await tx.table("evidence").toArray();
      const secondaryIds = new Set(
        evidence.filter((e: { tier?: string }) => e.tier === "secondary").map((e: { id: string }) => e.id),
      );
      await tx.table("timelineEvents").toCollection().modify((row: {
        sourceDocId?: string;
        tier?: string;
        isVerified?: boolean;
      }) => {
        if (row.sourceDocId && secondaryIds.has(row.sourceDocId)) {
          row.tier = "secondary";
        } else if (!row.tier) {
          row.tier = "primary";
        }
      });
    });
  }
}

export const db = new DossierDB();
