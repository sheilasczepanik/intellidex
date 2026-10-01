import type { EntityRecord, TimelineEventRecord } from "../db/schema";

export type ConfidenceTier = "TIER_1_VERIFIED" | "TIER_2_UNVERIFIED" | "TIER_3_CONTRADICTED";

export type SwimlaneGroupId = "subject" | "official" | "sightings";

export type TimelineGeo = { lat: number; lng: number; label: string };

const SIGHTING_RE = /sighting|civilian tip|\btip\b|witness|reported seen|last seen|seen near|caller reported/i;
const OFFICIAL_RE = /dispatch|officer|sergeant|detective|investigator|police|trooper|sheriff|law enforcement|\b911\b|state police/i;

export function parseTimeEnd(timeEnd: string | undefined, startMs: number): number | undefined {
  const raw = timeEnd?.trim();
  if (!raw) return undefined;
  if (/^\d{10,}$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > startMs ? n : undefined;
  }
  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (clock) {
    const start = new Date(startMs);
    const end = new Date(start);
    end.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (end.getTime() <= startMs) end.setDate(end.getDate() + 1);
    return end.getTime();
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= startMs) return undefined;
  return parsed;
}

export function eventRange(event: { timestamp: number; timeEnd?: string }): [number, number] {
  const start = event.timestamp;
  const end = parseTimeEnd(event.timeEnd, start) ?? start;
  return [start, Math.max(start, end)];
}

export function isSightingEvent(event: { title: string; description?: string; confidenceTier?: ConfidenceTier }, entity?: { role?: string; name?: string } | null) {
  if (event.confidenceTier === "TIER_2_UNVERIFIED") return true;
  const blob = `${event.title} ${event.description || ""} ${entity?.role || ""} ${entity?.name || ""}`;
  return SIGHTING_RE.test(blob);
}

export function confidenceTierOf(
  event: { isVerified: boolean; confidenceTier?: ConfidenceTier },
  contradicted = false,
): ConfidenceTier {
  if (contradicted) return "TIER_3_CONTRADICTED";
  if (event.confidenceTier === "TIER_3_CONTRADICTED") return "TIER_3_CONTRADICTED";
  if (event.confidenceTier === "TIER_2_UNVERIFIED" || event.confidenceTier === "TIER_1_VERIFIED") {
    return event.confidenceTier;
  }
  return event.isVerified ? "TIER_1_VERIFIED" : "TIER_2_UNVERIFIED";
}

export function swimlaneGroupFor(
  lane: { name: string; role?: string; type?: string; note?: string },
  subjectName?: string,
): SwimlaneGroupId {
  const blob = `${lane.name} ${lane.role || ""} ${lane.note || ""}`;
  const subject = (subjectName || "").trim().toLowerCase();
  const name = lane.name.trim().toLowerCase();
  if (subject && (name === subject || name.includes(subject) || subject.includes(name))) return "subject";
  if (/missing_person|missing person|\bsubject\b|\bvictim\b/i.test(lane.role || "")) return "subject";
  if (OFFICIAL_RE.test(blob)) return "official";
  return "sightings";
}

export function parseCoordinates(raw?: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const match = raw.match(/(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function coordinatesForEntity(entity?: EntityRecord | null): TimelineGeo | null {
  if (!entity) return null;
  const parsed = parseCoordinates(entity.metadata?.coordinates || entity.metadata?.coords || entity.notes);
  if (!parsed) return null;
  return { ...parsed, label: entity.name };
}

export function primaryIncidentGeo(entities: EntityRecord[], lksLocation?: string): TimelineGeo | null {
  const places = entities.filter((row) => row.type === "place" || row.type === "location");
  const lastSeen = places.find((row) => /last_seen|last known|crash/i.test(`${row.role} ${row.metadata?.locationKind || ""} ${row.name}`));
  const named = lksLocation
    ? places.find((row) => row.name.toLowerCase().includes(lksLocation.toLowerCase()) || lksLocation.toLowerCase().includes(row.name.toLowerCase()))
    : undefined;
  return coordinatesForEntity(lastSeen) || coordinatesForEntity(named) || places.map(coordinatesForEntity).find(Boolean) || null;
}

export function coordinatesForEvent(event: TimelineEventRecord, entities: EntityRecord[]): TimelineGeo | null {
  if (typeof event.latitude === "number" && typeof event.longitude === "number") {
    return { lat: event.latitude, lng: event.longitude, label: event.title };
  }
  const own = entities.find((row) => row.id === event.entityId);
  const ownGeo = coordinatesForEntity(own);
  if (ownGeo && (own?.type === "place" || own?.type === "location")) return ownGeo;
  const blob = `${event.title} ${event.description}`.toLowerCase();
  const mentioned = entities
    .filter((row) => row.type === "place" || row.type === "location")
    .find((row) => blob.includes(row.name.toLowerCase()));
  return coordinatesForEntity(mentioned) || coordinatesFromDescription(event);
}

function coordinatesFromDescription(event: TimelineEventRecord): TimelineGeo | null {
  const parsed = parseCoordinates(event.description);
  if (!parsed) return null;
  return { ...parsed, label: event.title };
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}
