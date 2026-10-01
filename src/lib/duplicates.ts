import { db, deleteCaseMedia, deleteEntity, deleteEvidence, deleteTimelineEvent, updateCaseMedia, updateEntity, updateTimelineEvent, type CaseMediaRecord, type EntityRecord, type EvidenceRecord, type TimelineEventRecord } from "../db";
import { calculateSHA256FromText } from "./cryptoUtils";
import { namesLooselyMatch } from "./eventTime";
import { metersBetween, parseCoordinates, type LatLng } from "./geo";
import { mergeLocations } from "./useLocations";

export type DupKind = "media" | "evidence" | "event" | "location" | "person";
export type DupDecision = "keep_existing" | "keep_new" | "merge";

export type DupSide = {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  meta: string;
  newer?: boolean;
};

export type DupMatch = {
  kind: DupKind;
  existing: DupSide;
  incoming: DupSide;
  existingId: string;
};

function normText(value: string) {
  return value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normUrl(raw?: string) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export async function hashNormalizedText(text: string) {
  return calculateSHA256FromText(normText(text));
}

export function mediaToSide(row: CaseMediaRecord, incoming?: boolean): DupSide {
  return {
    id: row.id,
    title: row.title,
    subtitle: [row.type.toUpperCase(), row.category.replace(/_/g, " "), row.originalFileName].filter(Boolean).join(" · "),
    body: row.summary || row.description || row.sourceUrl || "No narrative stored.",
    meta: [row.sha256Hash ? `SHA-256 ${row.sha256Hash.slice(0, 12)}…` : "", row.sourceUrl, new Date(row.dateAdded).toLocaleString()].filter(Boolean).join(" · "),
    newer: incoming,
  };
}

export function evidenceToSide(row: EvidenceRecord, incoming?: boolean): DupSide {
  return {
    id: row.id,
    title: row.originalFileName || row.fileName,
    subtitle: `${row.fileType || row.sourceType || "file"} · ${row.status}`,
    body: (row.fullText || row.rawText || "").slice(0, 420) || "No extracted text.",
    meta: [row.sha256Hash ? `SHA-256 ${row.sha256Hash.slice(0, 12)}…` : "", row.sourceUrl, row.ingestedAt].filter(Boolean).join(" · "),
    newer: incoming,
  };
}

export function eventToSide(row: TimelineEventRecord, incoming?: boolean): DupSide {
  return {
    id: row.id,
    title: row.title,
    subtitle: new Date(row.timestamp).toLocaleString(),
    body: row.description || "No description.",
    meta: row.sourceCitation?.sourceName || row.sourceDocId || "Manual event",
    newer: incoming,
  };
}

export function entityToSide(row: EntityRecord, incoming?: boolean): DupSide {
  return {
    id: row.id,
    title: row.name,
    subtitle: `${row.type} · ${row.role}`,
    body: [row.metadata?.address, row.metadata?.coordinates, row.notes].filter(Boolean).join("\n") || "No notes.",
    meta: row.createdAt || "",
    newer: incoming,
  };
}

export async function findDuplicateMedia(caseId: string, input: { sha256Hash?: string; sourceUrl?: string; excludeId?: string }) {
  const rows = await db.caseMedia.where("caseId").equals(caseId).toArray();
  const hash = (input.sha256Hash || "").toLowerCase();
  const url = normUrl(input.sourceUrl);
  return rows.find((row) => {
    if (row.id === input.excludeId) return false;
    if (hash && (row.sha256Hash || "").toLowerCase() === hash) return true;
    if (url && normUrl(row.sourceUrl) === url) return true;
    return false;
  }) ?? null;
}

export async function findDuplicateEvidence(caseId: string, sha256Hash?: string, excludeId?: string) {
  const hash = (sha256Hash || "").toLowerCase();
  if (!hash) return null;
  const rows = await db.evidence.where("caseId").equals(caseId).toArray();
  return rows.find((row) => row.id !== excludeId && (row.sha256Hash || "").toLowerCase() === hash) ?? null;
}

export async function findDuplicateEvent(caseId: string, input: { title: string; description: string; timestamp: number; entityId: string; excludeId?: string }) {
  const incomingHash = await hashNormalizedText(`${input.title} ${input.description}`);
  const rows = await db.timelineEvents.where("caseId").equals(caseId).toArray();
  const windowMs = 15 * 60 * 1000;
  for (const row of rows) {
    if (row.id === input.excludeId) continue;
    const closeTime = Math.abs(row.timestamp - input.timestamp) <= windowMs;
    if (!closeTime) continue;
    const samePlace = row.entityId === input.entityId;
    const sameText = normText(row.title) === normText(input.title) || (row.contentHash && row.contentHash === incomingHash);
    if (samePlace || sameText) return row;
  }
  return null;
}

function entityPoint(entity: EntityRecord, fallback?: LatLng | null): LatLng | null {
  return parseCoordinates(entity.metadata?.coordinates || entity.metadata?.coords || "") || fallback || null;
}

export async function findDuplicateLocation(
  caseId: string,
  input: { name: string; address?: string; latlng?: LatLng | null; excludeId?: string },
) {
  const rows = (await db.entities.where("caseId").equals(caseId).toArray())
    .filter((e) => e.type === "place" || e.type === "location");
  const name = normText(input.name);
  const address = normText(input.address || "");
  for (const row of rows) {
    if (row.id === input.excludeId) continue;
    if (name && normText(row.name) === name) return row;
    const rowAddr = normText(row.metadata?.address || "");
    if (address && rowAddr && address === rowAddr) return row;
    const point = entityPoint(row);
    if (input.latlng && point && metersBetween(input.latlng, point) <= 50) return row;
  }
  return null;
}

export function clusterDuplicateLocations(places: EntityRecord[]) {
  const clusters: EntityRecord[][] = [];
  const used = new Set<string>();
  for (const place of places) {
    if (used.has(place.id)) continue;
    const group = [place];
    used.add(place.id);
    const name = normText(place.name);
    const address = normText(place.metadata?.address || place.notes || "");
    const point = entityPoint(place);
    for (const other of places) {
      if (used.has(other.id)) continue;
      const otherName = normText(other.name);
      const otherAddr = normText(other.metadata?.address || other.notes || "");
      const otherPoint = entityPoint(other);
      const nameHit = Boolean(name && otherName && name === otherName);
      const addrHit = Boolean(address && otherAddr && address === otherAddr);
      const near = Boolean(point && otherPoint && metersBetween(point, otherPoint) <= 50);
      if (!nameHit && !addrHit && !near) continue;
      group.push(other);
      used.add(other.id);
    }
    if (group.length > 1) clusters.push(group);
  }
  return clusters;
}

export async function mergeLocationCluster(ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length < 2) return null;
  const rows = (await Promise.all(unique.map((id) => db.entities.get(id)))).filter(Boolean) as EntityRecord[];
  if (rows.length < 2) return null;
  const primary = rows.find((row) => {
    const blob = `${row.classification || ""} ${row.role || ""}`;
    return /verified/i.test(blob) && !/unverified/i.test(blob);
  }) || rows[0];
  for (const duplicate of rows) {
    if (duplicate.id === primary.id) continue;
    await mergeLocations(primary.id, duplicate.id);
  }
  return primary.id;
}

export async function findDuplicatePerson(caseId: string, name: string, excludeId?: string) {
  const rows = (await db.entities.where("caseId").equals(caseId).toArray()).filter((e) => e.type === "person");
  return rows.find((row) => row.id !== excludeId && namesLooselyMatch(row.name, name)) ?? null;
}

export async function applyDupDecision(match: DupMatch, decision: DupDecision, incomingPayload?: unknown) {
  if (decision === "keep_existing") return { action: "abort" as const, canonicalId: match.existingId };
  if (decision === "keep_new") {
    if (match.kind === "media") await deleteCaseMedia(match.existingId);
    if (match.kind === "evidence") await deleteEvidence(match.existingId);
    if (match.kind === "event") await deleteTimelineEvent(match.existingId);
    if (match.kind === "location" || match.kind === "person") await deleteEntity(match.existingId);
    return { action: "replace" as const, canonicalId: null };
  }
  if (match.kind === "media") {
    const incoming = incomingPayload as CaseMediaRecord;
    const existing = await db.caseMedia.get(match.existingId);
    if (existing && incoming) {
      await updateCaseMedia(existing.id, {
        summary: [existing.summary, incoming.summary, incoming.description].filter(Boolean).join("\n"),
        mergedFrom: [...(existing.mergedFrom || []), incoming.id].filter(Boolean),
      });
    }
  }
  if (match.kind === "event") {
    const incoming = incomingPayload as TimelineEventRecord;
    const existing = await db.timelineEvents.get(match.existingId);
    if (existing && incoming) {
      await updateTimelineEvent(existing.id, {
        description: [existing.description, incoming.description].filter(Boolean).join("\n"),
      });
      await db.timelineEvents.update(existing.id, {
        mergedFrom: [...(existing.mergedFrom || []), incoming.id].filter(Boolean),
      });
    }
  }
  if (match.kind === "location" || match.kind === "person") {
    const incoming = incomingPayload as EntityRecord;
    const existing = await db.entities.get(match.existingId);
    if (existing && incoming) {
      await updateEntity(existing.id, {
        notes: [existing.notes, incoming.notes].filter(Boolean).join("\n"),
      });
      await db.entities.update(existing.id, {
        metadata: {
          ...existing.metadata,
          mergedFrom: [...(existing.metadata?.mergedFrom ? [existing.metadata.mergedFrom] : []), incoming.id].join(","),
        },
      });
    }
  }
  if (match.kind === "evidence") {
    const incoming = incomingPayload as EvidenceRecord;
    const existing = await db.evidence.get(match.existingId);
    if (existing && incoming?.fileName && incoming.fileName !== existing.fileName) {
      await db.evidence.update(existing.id, {
        originalFileName: `${existing.originalFileName || existing.fileName} · ${incoming.fileName}`,
      });
    }
  }
  return { action: "merge" as const, canonicalId: match.existingId };
}
