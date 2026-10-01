import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, Shield, User } from "lucide-react";
import { LANE_PAD } from "./lib/timelineView";
import { useTimelineEvents, type TimelineLaneLike } from "./lib/useTimelineEvents";
import type { SwimlaneGroupId } from "./types/timeline";

const GROUP_CHROME: Record<SwimlaneGroupId, {
  title: (subjectName?: string) => string;
  badge: string;
  iconWrap: string;
  Icon: typeof User;
}> = {
  subject: {
    title: (subjectName) => `Subject Movements (${subjectName?.trim() || "Maura Murray"})`,
    badge: "border-indigo-200 bg-indigo-50 text-indigo-900",
    iconWrap: "bg-slate-800 text-white",
    Icon: User,
  },
  official: {
    title: () => "Official Dispatch & Law Enforcement",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-900",
    iconWrap: "bg-emerald-600 text-white",
    Icon: Shield,
  },
  sightings: {
    title: () => "Witness Sightings & Civilian Tips",
    badge: "border-amber-200 bg-amber-50 text-amber-950",
    iconWrap: "bg-amber-500 text-white",
    Icon: Eye,
  },
};

export type TimelineGridLane = TimelineLaneLike & {
  def: { id: string; name: string; role?: string; type?: string; note?: string };
  height: number;
};

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
  renderLane: (lane: T, groupId: SwimlaneGroupId) => ReactNode;
}) {
  const groups = useTimelineEvents(lanes, subjectName);

  return (
    <>
      {groups.map((group) => {
        const chrome = GROUP_CHROME[group.id];
        const Icon = chrome.Icon;
        const closed = collapsed[group.id];
        const title = chrome.title(subjectName);
        return (
          <section key={group.id}>
            <div className="relative h-10 border-b border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => onToggle(group.id)}
                aria-expanded={!closed}
                className="sticky left-0 z-[4] flex h-10 max-w-full items-center gap-2 bg-white/95 px-4 text-left backdrop-blur-sm"
              >
                {closed
                  ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                  : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />}
                <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${chrome.badge}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${chrome.iconWrap}`}>
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                  <span className="truncate">{title}</span>
                </span>
                <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {group.events} {group.events === 1 ? "Event" : "Events"}
                </span>
              </button>
            </div>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${closed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
            >
              <div className="overflow-hidden">
                {group.events === 0 ? (
                  <div className="flex min-h-9 items-center border-b border-slate-100 bg-slate-50/60">
                    <div
                      className="sticky left-0 flex min-h-9 items-center bg-slate-50/90 px-5 text-[12px] text-slate-400"
                      style={{ width: LANE_PAD }}
                    >
                      No recorded movements for this date
                    </div>
                  </div>
                ) : group.rows.map((lane) => renderLane(lane, group.id))}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
