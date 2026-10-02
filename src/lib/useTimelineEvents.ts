import { useMemo } from "react";
import { swimlaneGroupFor, type SwimlaneGroupId } from "../types/timeline";

export type TimelineLaneLike = {
  def: { id?: string; name: string; role?: string; type?: string; note?: string; group?: SwimlaneGroupId };
  count: number;
  placed?: { e?: { title?: string; sub?: string; verified?: boolean; sighting?: boolean } }[];
};

/** Place a lane in Subject Movements, Official Dispatch, or Witness Sightings. */
export function categorizeTimelineLane(lane: TimelineLaneLike, subjectName?: string): SwimlaneGroupId {
  const events = (lane.placed ?? [])
    .map((row) => `${row.e?.title || ""} ${row.e?.sub || ""} ${row.e?.sighting ? "sighting tip" : ""}`)
    .join(" ");
  if (lane.def.group) return lane.def.group;
  const verifiedVehicle = lane.def.type === "vehicle" && (lane.placed ?? []).some((row) => row.e?.verified !== false);
  return swimlaneGroupFor({
    name: lane.def.name,
    role: lane.def.role,
    type: lane.def.type,
    note: `${lane.def.note || ""} ${events} ${verifiedVehicle ? "verified vehicle" : ""}`,
  }, subjectName);
}

export function groupTimelineLanes<T extends TimelineLaneLike>(lanes: T[], subjectName?: string) {
  const order: SwimlaneGroupId[] = ["subject", "official", "sightings"];
  return order.map((id) => {
    const rows = lanes.filter((lane) => categorizeTimelineLane(lane, subjectName) === id);
    const events = rows.reduce((sum, lane) => sum + (lane.placed?.length ?? lane.count ?? 0), 0);
    return { id, rows, events };
  });
}

export function useTimelineEvents<T extends TimelineLaneLike>(lanes: T[], subjectName?: string) {
  return useMemo(() => groupTimelineLanes(lanes, subjectName), [lanes, subjectName]);
}
