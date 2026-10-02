import { useMemo } from "react";
import type { EntityRecord, TimelineEventRecord } from "../db";
import { actionableCaseConflicts, detectCaseConflicts } from "./conflictDetection";
import { eventRange } from "../types/timeline";

export type TimelineConflict = {
  aId: string;
  bId: string;
  entityId: string;
  label: string;
  detail: string;
};

const SAME_PLACE_SLACK_MS = 2 * 60 * 1000;

function placeName(event: TimelineEventRecord, entities: EntityRecord[]) {
  const own = entities.find((row) => row.id === event.entityId);
  if (own && (own.type === "place" || own.type === "location")) return own.name;
  const blob = `${event.title} ${event.description}`.toLowerCase();
  const mentioned = entities
    .filter((row) => (row.type === "place" || row.type === "location") && blob.includes(row.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return mentioned?.name || "";
}

function rangesOverlap(a: [number, number], b: [number, number]) {
  return a[0] - SAME_PLACE_SLACK_MS <= b[1] && b[0] - SAME_PLACE_SLACK_MS <= a[1];
}

/** Same entity cited in two different locations over overlapping times. */
export function findTimelineConflicts(events: TimelineEventRecord[], entities: EntityRecord[]): TimelineConflict[] {
  const pairs: TimelineConflict[] = [];
  const seen = new Set<string>();
  const byEntity = new Map<string, TimelineEventRecord[]>();
  for (const event of events) {
    if (!event.entityId) continue;
    const list = byEntity.get(event.entityId) ?? [];
    list.push(event);
    byEntity.set(event.entityId, list);
  }
  for (const [entityId, rows] of byEntity) {
    const entity = entities.find((row) => row.id === entityId);
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (!rangesOverlap(eventRange(a), eventRange(b))) continue;
        const placeA = placeName(a, entities);
        const placeB = placeName(b, entities);
        if (!placeA || !placeB || placeA.toLowerCase() === placeB.toLowerCase()) continue;
        const key = [a.id, b.id].sort().join("::");
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          aId: a.id,
          bId: b.id,
          entityId,
          label: "Timeline conflict",
          detail: `${entity?.name || "This entity"} is cited at ${placeA} and ${placeB} over the same time.`,
        });
      }
    }
  }
  return pairs;
}

export function useTimelineConflicts(events: TimelineEventRecord[], caseId?: string | null) {
  return useMemo(() => {
    const scoped = events.filter((event) => !caseId || event.caseId === caseId);
    return actionableCaseConflicts(detectCaseConflicts(scoped)).flatMap((conflict) => {
      const [first, ...rest] = conflict.eventIds;
      if (!first) return [];
      return rest.map((other) => ({
        aId: first,
        bId: other,
        entityId: "",
        label: conflict.title,
        detail: conflict.description,
      }));
    });
  }, [events, caseId]);
}
