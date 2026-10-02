import type { EntityRecord, TimelineEventRecord } from "../db/schema";
import { actionableCaseConflicts, detectCaseConflicts } from "./conflictDetection";

const TRANSIT_CONFLICT_MS = 50 * 60 * 1000;

export interface TimelineConflict {
  aId: string;
  bId: string;
  label: string;
  detail: string;
}

export function detectTimelineConflicts(
  events: TimelineEventRecord[],
  entities: EntityRecord[],
): TimelineConflict[] {
  const places = entities.filter((e) => e.type === "place" || e.type === "location");
  const conflictIds = new Set<string>();
  const pairs: TimelineConflict[] = [];
  const addPair = (aId: string, bId: string, label: string, detail: string) => {
    if (conflictIds.has(aId) && conflictIds.has(bId)) return;
    conflictIds.add(aId);
    conflictIds.add(bId);
    pairs.push({ aId, bId, label, detail });
  };

  const scoped = events.filter((event) => event.caseId === events[0]?.caseId);
  for (const conflict of actionableCaseConflicts(detectCaseConflicts(scoped))) {
    const [first, ...rest] = conflict.eventIds;
    rest.forEach((other) => addPair(first, other, conflict.title, conflict.description));
  }

  const mentionsPlace = (blob: string, place: EntityRecord) =>
    blob.toLowerCase().includes(place.name.toLowerCase());

  const byEntity = new Map<string, TimelineEventRecord[]>();
  events.forEach((e) => {
    const list = byEntity.get(e.entityId) ?? [];
    list.push(e);
    byEntity.set(e.entityId, list);
  });
  for (const evs of byEntity.values()) {
    const sorted = [...evs].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const dt = b.timestamp - a.timestamp;
      if (dt <= 0 || dt > TRANSIT_CONFLICT_MS) continue;
      const blobA = `${a.title} ${a.description}`;
      const blobB = `${b.title} ${b.description}`;
      const pa = places.filter((p) => mentionsPlace(blobA, p));
      const pb = places.filter((p) => mentionsPlace(blobB, p));
      const disjoint = pa.some((p) => !pb.some((q) => q.id === p.id)) && pb.some((p) => !pa.some((q) => q.id === p.id));
      if (!disjoint) continue;
      const mins = Math.round(dt / 60000);
      addPair(a.id, b.id, "Impossible transit", `${mins} min between ${pa[0].name} and ${pb[0].name}.`);
    }
  }
  return pairs;
}
