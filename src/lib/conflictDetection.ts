export interface CaseConflict {
  id: string;
  type: "CONTRADICTION" | "TEMPORAL_OVERLAP" | "LOCATION_MISMATCH" | "CORROBORATION_DUPLICATE";
  title: string;
  severity: "high" | "medium" | "info";
  description: string;
  eventIds: string[];
  timestamps: string[];
  sources: string[];
}

type ConflictEvent = {
  id: string;
  caseId?: string;
  title?: string;
  details?: string;
  description?: string;
  timestamp?: string | number | null;
  location?: string;
  latitude?: number;
  longitude?: number;
  sourceDoc?: string;
  sourceId?: string;
  source?: string;
  sourceDocId?: string;
  sourceCitation?: { sourceName?: string };
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Minute bucket `YYYY-MM-DDTHH:mm` for an ISO string or epoch milliseconds. */
export function conflictTimeKey(timestamp: string | number | null | undefined) {
  if (timestamp == null || timestamp === "") return "";
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const raw = String(timestamp).trim();
  if (/^\d{10,}$/.test(raw)) return conflictTimeKey(Number(raw));
  return raw.slice(0, 16);
}

function eventText(event: ConflictEvent) {
  return `${event.title || ""} ${event.details || ""} ${event.description || ""}`;
}

function eventLocation(event: ConflictEvent) {
  if (event.location) return event.location;
  if (typeof event.latitude === "number" && typeof event.longitude === "number") {
    return `${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`;
  }
  return "";
}

function eventSource(event: ConflictEvent) {
  return event.sourceDoc || event.sourceId || event.source || event.sourceCitation?.sourceName || event.sourceDocId || "Unknown";
}

export function detectCaseConflicts(events: ConflictEvent[]): CaseConflict[] {
  const conflicts: CaseConflict[] = [];
  const timeMap = new Map<string, ConflictEvent[]>();

  events.forEach((evt) => {
    const timeKey = conflictTimeKey(evt.timestamp);
    if (!timeKey) return;
    const list = timeMap.get(timeKey) ?? [];
    list.push(evt);
    timeMap.set(timeKey, list);
  });

  timeMap.forEach((timeEvents, timeKey) => {
    if (timeEvents.length <= 1) return;
    const distinctSources = Array.from(new Set(timeEvents.map((event) => eventSource(event))));
    const distinctLocations = Array.from(new Set(timeEvents.map((event) => eventLocation(event)).filter(Boolean)));
    if (distinctLocations.length > 1) {
      conflicts.push({
        id: `conflict-loc-${timeKey}`,
        type: "LOCATION_MISMATCH",
        severity: "high",
        title: `Conflicting Locations at ${timeKey.replace("T", " ")}`,
        description: `Simultaneous sightings reported at different coordinates: ${distinctLocations.join(" AND ")}.`,
        eventIds: timeEvents.map((event) => event.id),
        timestamps: [timeKey],
        sources: distinctSources,
      });
      return;
    }
    conflicts.push({
      id: `conflict-dup-${timeKey}`,
      type: "CORROBORATION_DUPLICATE",
      severity: "info",
      title: `Multiple Records at ${timeKey.replace("T", " ")}`,
      description: `Discrepancy or corroboration across sources: ${distinctSources.join(", ")}.`,
      eventIds: timeEvents.map((event) => event.id),
      timestamps: [timeKey],
      sources: distinctSources,
    });
  });

  const bereavementEvt = events.find((event) => /bereavement|death in the family/i.test(eventText(event)));
  const familyEvt = events.find((event) => /no death|family confirmed no tragedy/i.test(eventText(event)));
  if (bereavementEvt && familyEvt) {
    conflicts.push({
      id: "conflict-statement-bereavement",
      type: "CONTRADICTION",
      severity: "high",
      title: "Contradictory Statement: Bereavement vs Family Verification",
      description: "Email cited a family death as reason for absence, but family members stated no death or family tragedy occurred.",
      eventIds: [bereavementEvt.id, familyEvt.id],
      timestamps: [conflictTimeKey(bereavementEvt.timestamp), conflictTimeKey(familyEvt.timestamp)].filter(Boolean),
      sources: [eventSource(bereavementEvt), eventSource(familyEvt)],
    });
  }

  const alcoholEvt = events.find((event) => /wine.*dash|beer|bottles|liquor/i.test(eventText(event)));
  const soberEvt = events.find((event) => /didn't drink much|not a heavy drinker|hadn't had a drink/i.test(eventText(event)));
  if (alcoholEvt && soberEvt) {
    conflicts.push({
      id: "conflict-statement-alcohol",
      type: "CONTRADICTION",
      severity: "medium",
      title: "Discrepancy: Alcohol Evidence vs Witness Perception",
      description: "Physical evidence at scene showed open containers and spillage, contrasting with statements regarding moderate alcohol habits.",
      eventIds: [alcoholEvt.id, soberEvt.id],
      timestamps: [conflictTimeKey(alcoholEvt.timestamp), conflictTimeKey(soberEvt.timestamp)].filter(Boolean),
      sources: [eventSource(alcoholEvt), eventSource(soberEvt)],
    });
  }

  return conflicts;
}

/** Contradictions and location mismatches. Same-minute corroboration stays informational. */
export function actionableCaseConflicts(conflicts: CaseConflict[]) {
  return conflicts.filter((conflict) => conflict.severity !== "info");
}
