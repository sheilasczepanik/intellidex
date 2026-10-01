import type { ReactNode } from "react";
import { Eye, Shield, User } from "lucide-react";
import { LANE_PAD } from "./lib/timelineView";
import { useTimelineEvents, type TimelineLaneLike } from "./lib/useTimelineEvents";
import type { SwimlaneGroupId } from "./types/timeline";

const GROUP_WASH: Record<SwimlaneGroupId, string> = {
  subject: "bg-slate-100/90 dark:bg-zinc-800/90 border-y border-slate-200 dark:border-zinc-700",
  official: "bg-emerald-50/80 dark:bg-emerald-950/30 border-y border-emerald-200 dark:border-emerald-800",
  sightings: "bg-amber-50/80 dark:bg-amber-950/30 border-y border-amber-200 dark:border-amber-800",
};

const GROUP_CHROME: Record<SwimlaneGroupId, {
  title: (subjectName?: string) => string;
  iconWrap: string;
  Icon: typeof User;
}> = {
  subject: {
    title: (subjectName) => `Subject Movements${subjectName?.trim() ? ` (${subjectName.trim()})` : ""}`,
    iconWrap: "bg-blue-600 text-white",
    Icon: User,
  },
  official: {
    title: () => "Official Dispatch & Law Enforcement",
    iconWrap: "bg-emerald-600 text-white",
    Icon: Shield,
  },
  sightings: {
    title: () => "Witness Sightings & Civilian Tips",
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
        const activeLanes = group.rows.filter((row) => (row.placed?.length ?? row.count) > 0).length;
        return (
          <section key={group.id} className="w-full">
            <div className={`relative w-full ${GROUP_WASH[group.id]}`}>
              <button
                type="button"
                onClick={() => onToggle(group.id)}
                aria-expanded={!closed}
                className="sticky left-0 z-[4] flex h-10 w-max max-w-full items-center gap-2 px-4 text-left"
              >
                <span className="w-3 shrink-0 text-[12px] text-slate-600 dark:text-zinc-300" aria-hidden>
                  {closed ? "▸" : "▾"}
                </span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${chrome.iconWrap}`}>
                  <Icon className="h-3 w-3" />
                </span>
                <span className="truncate text-[13px] font-semibold text-slate-900 dark:text-zinc-100">{title}</span>
                <span className="shrink-0 rounded-full border border-slate-300/80 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-200">
                  {activeLanes} Active {activeLanes === 1 ? "Lane" : "Lanes"} · {group.events} {group.events === 1 ? "Event" : "Events"}
                </span>
              </button>
            </div>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${closed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
            >
              <div className="overflow-hidden">
                {group.rows.length === 0 ? (
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
