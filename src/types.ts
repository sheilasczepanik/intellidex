/** Creator / host identity (podcast, publication, or lead researcher). */
export type CreatorProfile = {
  creatorName: string;
  showTitle: string;
  role: string;
};

export type CaseLifecycleStatus = "active" | "archived" | "cold" | "closed";

export interface Case {
  isArchived: boolean;
  archivedAt?: string;
  status: CaseLifecycleStatus;
}

export type SourceType = "pdf" | "image" | "text" | "web_article" | "external_intel";

export type IntelSourceType =
  | "forum_tip"
  | "news_report"
  | "scanner_audio"
  | "witness_lead"
  | "foia_document"
  | "other";

export type IntelClaimCategory = "person" | "vehicle" | "location" | "alibi" | "sighting" | "evidence";

export interface IntelClaim {
  id: string;
  leadId: string;
  category: IntelClaimCategory;
  claimText: string;
  extractedTimestamp?: string | null;
  verbatimQuote: string;
  confidence: number;
  triageStatus: "pending" | "promoted" | "dismissed";
  promotedToVerifyQueue?: boolean;
}

export interface ExternalIntelLead {
  id: string;
  caseId: string;
  title: string;
  sourceUrl?: string;
  sourceType: IntelSourceType;
  rawContent: string;
  sha256Hash: string;
  createdAt: string;
  status: "unparsed" | "triaged" | "archived";
  claims: IntelClaim[];
}

export interface SourceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceCitation {
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  pageNumber?: number;
  exactQuote: string;
  boundingBox?: SourceBoundingBox;
  sourceUrl?: string;
  sourceHash?: string;
}

export function inferSourceType(file: {
  fileType?: string;
  mediaType?: string;
  fileName?: string;
  fileBase64?: string;
  imageBase64?: string;
  sourceType?: string;
  sourceUrl?: string;
}): SourceType {
  if (file.sourceType === "external_intel" || file.fileType === "external_intel") {
    return "external_intel";
  }
  if (file.sourceType === "web_article" || file.fileType === "web_article" || Boolean(file.sourceUrl)) {
    return "web_article";
  }
  const type = (file.fileType || "").toLowerCase();
  const media = (file.mediaType || "").toLowerCase();
  const name = (file.fileName || "").toLowerCase();
  if (type === "pdf" || media === "application/pdf" || name.endsWith(".pdf") || Boolean(file.fileBase64 && type === "pdf")) {
    return "pdf";
  }
  if (type.startsWith("image") || media.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name) || Boolean(file.imageBase64)) {
    return "image";
  }
  return "text";
}

export function normalizeBoundingBox(raw: unknown): SourceBoundingBox | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  let x = Number(b.x);
  let y = Number(b.y);
  let width = Number(b.width ?? b.w);
  let height = Number(b.height ?? b.h);
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return undefined;
  const max = Math.max(x, y, width, height);
  if (max <= 1.5) {
    x *= 100;
    y *= 100;
    width *= 100;
    height *= 100;
  }
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return { x: clamp(x), y: clamp(y), width: clamp(width), height: clamp(height) };
}

export function citationPillLabel(citation: SourceCitation) {
  const quote = citation.exactQuote.replace(/\s+/g, " ").trim();
  const clip = quote.length > 42 ? `${quote.slice(0, 39)}…` : quote;
  const page = citation.pageNumber ? ` Page ${citation.pageNumber}` : "";
  const name = citation.sourceName.replace(/\.[^.]+$/, "") || "Doc";
  if (citation.sourceType === "external_intel") {
    const hash = citation.sourceHash ? ` ${citation.sourceHash.slice(0, 8)}…` : "";
    return `[${name}${hash}: “${clip}”]`;
  }
  if (citation.sourceType === "web_article" || citation.sourceUrl) {
    let host = "";
    try {
      host = citation.sourceUrl ? ` ${new URL(citation.sourceUrl).hostname}` : "";
    } catch {
      host = "";
    }
    return `[${name}${host}: “${clip}”]`;
  }
  return `[${name}${page}: “${clip}”]`;
}

export function parsePageNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.round(n);
}

export type EntityType = "person" | "vehicle" | "location" | "place" | "phone" | "digital" | "exhibit";

export const RELATIONSHIP_TYPES = [
  "registered_owner",
  "operator_driver",
  "passenger",
  "residence",
  "crime_scene",
  "last_known_location",
  "phone_subscriber",
  "cell_tower_ping",
  "associate_of",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface CaseEntity {
  id: string;
  caseId: string;
  type: EntityType;
  name: string;
  classification?: string;
  identifiers: string[];
  metadata: Record<string, string>;
  createdAt: string;
}

export interface EntityRelationship {
  id: string;
  caseId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  label: string;
  confidence: number;
  sourceCitationId?: string;
}

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  registered_owner: "Registered Owner",
  operator_driver: "Operator / Driver",
  passenger: "Passenger",
  residence: "Residence",
  crime_scene: "Crime Scene",
  last_known_location: "Last Known Location",
  phone_subscriber: "Phone Subscriber",
  cell_tower_ping: "Cell Tower Ping",
  associate_of: "Associate Of",
};

export function canonicalEntityType(value: string | null | undefined): Exclude<EntityType, "place"> {
  const s = (value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "vehicle" || s.includes("car") || s.includes("plate")) return "vehicle";
  if (s === "phone" || s.includes("handset") || s.includes("mobile")) return "phone";
  if (s === "digital" || s.includes("tower") || s.includes("imei") || s.includes("cctv") || s.includes("telecom")) return "digital";
  if (s === "exhibit" || s.includes("evidence") || s.includes("weapon")) return "exhibit";
  if (s === "person" || s.includes("suspect") || s.includes("witness") || s.includes("victim")) return "person";
  return "location";
}

export function storedEntityType(value: string | null | undefined): EntityType {
  const c = canonicalEntityType(value);
  if (c === "location") return (value || "").toLowerCase() === "place" ? "place" : "location";
  return c;
}

export function normalizeRelationshipType(value: unknown): RelationshipType {
  const s = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if ((RELATIONSHIP_TYPES as readonly string[]).includes(s)) return s as RelationshipType;
  if (s.includes("owner") || s.includes("register")) return "registered_owner";
  if (s.includes("driv") || s.includes("operat")) return "operator_driver";
  if (s.includes("passenger")) return "passenger";
  if (s.includes("resid") || s.includes("home") || s.includes("motel") || s.includes("lives")) return "residence";
  if (s.includes("crime") || s.includes("scene")) return "crime_scene";
  if (s.includes("last") && s.includes("loc")) return "last_known_location";
  if (s.includes("subscriber") || s.includes("phone")) return "phone_subscriber";
  if (s.includes("ping") || s.includes("tower")) return "cell_tower_ping";
  return "associate_of";
}

export function relationshipDisplayLabel(type: RelationshipType, label?: string) {
  const custom = (label || "").trim();
  if (custom) return custom;
  return RELATIONSHIP_LABELS[type];
}

export interface EvidenceCustody {
  sha256Hash: string;
  byteSize: number;
  ingestedAt: string;
  ingestedByCallsign: string;
  originalFileName: string;
  mimeType: string;
}

