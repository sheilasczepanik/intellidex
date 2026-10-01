import type { EntityRecord, TimelineEventRecord } from "../db";

export const MERGE_WINDOW_MS = 5 * 60 * 1000;
export const CONFLICT_SAME_MS = 2 * 60 * 1000;

export function normalizeIntelText(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\b(the|and|of)\b/g, " ")
    .replace(/\b(st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|hwy|route|rt|apt|unit|nr|no)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceRefKey(event: TimelineEventRecord) {
  return normalizeIntelText(
    event.sourceDocId
    || event.sourceCitation?.sourceName
    || event.sourceCitation?.sourceUrl
    || "",
  );
}

export function clusterMergeableEvents(events: TimelineEventRecord[]) {
  const groups: TimelineEventRecord[][] = [];
  const used = new Set<string>();
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  for (const event of sorted) {
    if (used.has(event.id)) continue;
    const group = [event];
    used.add(event.id);
    const title = normalizeIntelText(event.title);
    const source = sourceRefKey(event);
    for (const other of sorted) {
      if (used.has(other.id)) continue;
      if (other.entityId !== event.entityId) continue;
      if (Math.abs(other.timestamp - event.timestamp) > MERGE_WINDOW_MS) continue;
      const otherSource = sourceRefKey(other);
      if (source !== otherSource) continue;
      if (normalizeIntelText(other.title) !== title) continue;
      group.push(other);
      used.add(other.id);
    }
    groups.push(group);
  }
  return groups;
}

function placeForEvent(event: TimelineEventRecord, entities: EntityRecord[]) {
  const places = entities.filter((row) => row.type === "place" || row.type === "location");
  const own = entities.find((row) => row.id === event.entityId);
  if (own && (own.type === "place" || own.type === "location")) return own;
  const blob = `${event.title} ${event.description}`.toLowerCase();
  return places.find((place) => blob.includes(place.name.toLowerCase())) ?? null;
}

function involvesSubject(event: TimelineEventRecord, entities: EntityRecord[], subjectName?: string) {
  const needle = normalizeIntelText(subjectName || "");
  const subject = entities.find((row) => {
    if (row.type !== "person") return false;
    const name = normalizeIntelText(row.name);
    return needle ? name.includes(needle.split(" ")[0] || needle) || needle.includes(name) : /missing|subject|victim/.test(normalizeIntelText(row.role));
  });
  if (subject && event.entityId === subject.id) return true;
  if (!needle) return false;
  return normalizeIntelText(`${event.title} ${event.description}`).includes(needle.split(" ")[0] || needle);
}

export function detectLocationConflicts(
  events: TimelineEventRecord[],
  entities: EntityRecord[],
  subjectName?: string,
) {
  const relevant = events.filter((event) => involvesSubject(event, entities, subjectName));
  const pairs: { aId: string; bId: string; label: string; detail: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < relevant.length; i += 1) {
    for (let j = i + 1; j < relevant.length; j += 1) {
      const a = relevant[i];
      const b = relevant[j];
      if (Math.abs(a.timestamp - b.timestamp) > CONFLICT_SAME_MS) continue;
      const placeA = placeForEvent(a, entities);
      const placeB = placeForEvent(b, entities);
      if (!placeA || !placeB || placeA.id === placeB.id) continue;
      if (normalizeIntelText(placeA.name) === normalizeIntelText(placeB.name)) continue;
      const key = [a.id, b.id].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({
        aId: a.id,
        bId: b.id,
        label: "Timeline conflict",
        detail: `Subject logged at ${placeA.name} and ${placeB.name} at the same timestamp.`,
      });
    }
  }
  return pairs;
}
