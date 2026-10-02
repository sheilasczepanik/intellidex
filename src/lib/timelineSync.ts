import type { TimelineEventRecord, VerifyDraftRecord } from "../db";
import type { EntityType } from "../types";
import type { SwimlaneGroupId } from "../types/timeline";
import { namesLooselyMatch, preferNarrativeTimestamp } from "./eventTime";

export type TimelineLaneCategory = "SUBJECT" | "LAW_ENFORCEMENT" | "WITNESSES" | "EVIDENCE";

export type NormalizedTimelineEvent = {
  entityName: string;
  laneCategory: TimelineLaneCategory;
  timestamp: string;
};

const FINDINGS_LANE_IDS: Record<TimelineLaneCategory, string> = {
  SUBJECT: "__findings_subject__",
  LAW_ENFORCEMENT: "__findings_official__",
  WITNESSES: "__findings_witness__",
  EVIDENCE: "__findings_evidence__",
};

const FINDINGS_GROUPS: Record<TimelineLaneCategory, SwimlaneGroupId> = {
  SUBJECT: "subject",
  LAW_ENFORCEMENT: "official",
  WITNESSES: "sightings",
  EVIDENCE: "subject",
};

export function findingsLaneId(category: TimelineLaneCategory) {
  return FINDINGS_LANE_IDS[category];
}

export function isFindingsLane(id: string) {
  return Object.values(FINDINGS_LANE_IDS).includes(id);
}

export function findingsLanePresentation(id: string): { name: string; group: SwimlaneGroupId; type: EntityType } | null {
  const category = (Object.keys(FINDINGS_LANE_IDS) as TimelineLaneCategory[]).find((key) => FINDINGS_LANE_IDS[key] === id);
  if (!category) return null;
  return {
    name: "Investigative Findings & Notes",
    group: FINDINGS_GROUPS[category],
    type: category === "EVIDENCE" ? "exhibit" : "person",
  };
}

export function normalizeEventForTimeline(event: {
  title?: string;
  details?: string;
  summary?: string;
  description?: string;
  timestamp?: string | number | null;
  datetime?: string | null;
}): NormalizedTimelineEvent & { entityName: string; laneCategory: TimelineLaneCategory } {
  const titleLower = (event.title || "").toLowerCase();
  const detailsLower = (event.details || event.summary || event.description || "").toLowerCase();
  const blob = `${titleLower} ${detailsLower}`;

  let entityName = "Maura Murray";
  let laneCategory: TimelineLaneCategory = "SUBJECT";

  if (/smith|monaghan|police|officer|trooper|detective|oravec|davies|thrasher|dispatch|cjis/i.test(blob)) {
    laneCategory = "LAW_ENFORCEMENT";
    entityName = titleLower.includes("monaghan") ? "John Monaghan"
      : titleLower.includes("smith") ? "Cecil Smith"
      : titleLower.includes("oravec") ? "Gregory Oravec"
      : titleLower.includes("davies") ? "Brian Davies"
      : "Official Law Enforcement";
  } else if (/atwood|westman|mayotte|alfieri|friend|classmate|supervisor|resident/i.test(blob)) {
    laneCategory = "WITNESSES";
    entityName = titleLower.includes("atwood") ? "Butch Atwood"
      : titleLower.includes("westman") ? "Faith Westman"
      : titleLower.includes("alfieri") ? "Sara Alfieri"
      : titleLower.includes("mayotte") ? "Karen Mayotte"
      : "Witness Accounts";
  } else if (/tailpipe|saturn|corolla|vehicle|atm|computer|cash|wine|beer/i.test(blob)) {
    laneCategory = "EVIDENCE";
    entityName = "Physical & Digital Evidence";
  }

  const rawTime = event.timestamp ?? event.datetime ?? "2004-02-09T19:27:00";
  return {
    entityName,
    laneCategory,
    timestamp: typeof rawTime === "number" ? new Date(rawTime).toISOString() : String(rawTime),
  };
}

type LaneEntity = { id: string; name: string; type?: string };

function entityMentionedIn(blob: string, entities: LaneEntity[]) {
  const hay = blob.toLowerCase();
  return entities
    .filter((entity) => entity.type !== "place" && entity.type !== "location")
    .filter((entity) => entity.name.length >= 4 && hay.includes(entity.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

export function draftsAsTimelineEvents(drafts: VerifyDraftRecord[]): (TimelineEventRecord & { entityHint?: string })[] {
  return drafts
    .filter((draft) => draft.status !== "rejected")
    .map((draft) => ({
      id: draft.id.startsWith("draft-") ? draft.id : `draft-${draft.id}`,
      caseId: draft.caseId,
      entityId: draft.entityId || "",
      timestamp: draft.timestamp,
      title: draft.title,
      description: [draft.details, draft.snippet, draft.timestampLabel].filter(Boolean).join("\n"),
      sourceDocId: draft.evidenceId,
      isVerified: draft.status === "confirmed",
      sourceCitation: draft.sourceCitation,
      origin: draft.origin,
      confidenceTier: draft.status === "confirmed" ? "TIER_1_VERIFIED" : "TIER_2_UNVERIFIED",
      entityHint: draft.entityName,
    }));
}

export function prepareEventsForTimeline<T extends { id: string; entityId: string; timestamp: number; title: string; description: string; entityHint?: string }>(
  events: T[],
  entities: LaneEntity[],
): T[] {
  const known = new Set(entities.map((entity) => entity.id));
  return events.map((event) => {
    const narrative = `${event.title} ${event.description}`;
    const timestamp = preferNarrativeTimestamp(event.timestamp, narrative);
    if (event.entityId && known.has(event.entityId)) {
      return { ...event, timestamp };
    }
    const norm = normalizeEventForTimeline({
      title: event.title,
      details: event.description,
      summary: event.entityHint,
      timestamp,
    });
    const mentioned = entityMentionedIn(`${narrative} ${event.entityHint ?? ""} ${norm.entityName}`, entities);
    const named = entities.find((entity) => namesLooselyMatch(entity.name, norm.entityName) || (event.entityHint ? namesLooselyMatch(entity.name, event.entityHint) : false));
    return {
      ...event,
      timestamp,
      entityId: mentioned?.id || named?.id || findingsLaneId(norm.laneCategory),
    };
  });
}
