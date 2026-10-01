import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { swimlaneGroupFor, type SwimlaneGroupId } from "./types/timeline";

const mono = "font-mono";

export type TimelineGridLane = {
  def: { id: string; name: string; role?: string; type?: string; note?: string };
  height: number;
  count: number;
};

const GROUP_META: { id: SwimlaneGroupId; dot: string; label: (subjectName?: string) => string }[] = [
  {
    id: "subject",
    dot: "bg-blue-600",
    label: (subjectName) => `Primary Subject (${subjectName?.trim() || "Maura Murray"})`,
  },
  {
    id: "official",
    dot: "bg-emerald-600",
    label: () => "Official Dispatch & Law Enforcement",
  },
  {
    id: "sightings",
    dot: "bg-orange-500",
    label: () => "Reported Sightings & Civilian Tips",
  },
];

export default function TimelineGrid<T extends TimelineGridLane>({
  lanes,
  subjectName,
  collapsed,
  onToggle,
  renderLane,
}: {
  lanes: T[];
  subjectName?: string;
  collapsed: Record<SwimlaneGroupId, boolean>;
  onToggle: (id: SwimlaneGroupId) => void;
  renderLane: (lane: T) => ReactNode;
}) {
  const groups = GROUP_META.map((group) => {
    const rows = lanes.filter((lane) => swimlaneGroupFor(lane.def, subjectName) === group.id);
    const events = rows.reduce((sum, lane) => sum + lane.count, 0);
    return { ...group, rows, events, title: group.label(subjectName) };
  }).filter((group) => group.rows.length > 0);

  return (
    <>
      {groups.map((group) => {
        const closed = collapsed[group.id];
        return (
          <section key={group.id}>
            <button
              type="button"
              onClick={() => onToggle(group.id)}
              className="sticky left-0 z-[4] flex h-9 w-full items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-4 text-left backdrop-blur-sm"
            >
              {closed ? <ChevronRight className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
              <span className={`h-2 w-2 shrink-0 rounded-full ${group.dot}`} />
              <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-800">{group.title}</span>
              <span className={`shrink-0 ${mono} text-[10px] tracking-[0.08em] text-slate-500`}>
                {group.rows.length} {group.rows.length === 1 ? "LANE" : "LANES"} · {group.events} {group.events === 1 ? "EVENT" : "EVENTS"}
              </span>
            </button>
            {closed ? null : group.rows.map((lane) => renderLane(lane))}
          </section>
        );
      })}
    </>
  );
}
