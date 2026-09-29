import { Minus, Plus } from "lucide-react";
import {
  formatDayHeading,
  TIME_WINDOW_OPTIONS,
  type TickPreset,
  type TimeWindow,
} from "./lib/timelineView";

const mono = "font-mono";

type Props = {
  rangeLabel: string;
  dayLabel: string;
  timeLabel: string;
  dayKeys: string[];
  dayCounts: Record<string, number>;
  viewAllDates: boolean;
  activeDay: string;
  timeWindow: TimeWindow;
  customStart: string;
  customEnd: string;
  tickPreset: TickPreset;
  dateMenu: boolean;
  timeMenu: boolean;
  onToggleDateMenu: () => void;
  onToggleTimeMenu: () => void;
  onSelectDay: (day: string | "all") => void;
  onSelectWindow: (w: TimeWindow) => void;
  onCustomStart: (v: string) => void;
  onCustomEnd: (v: string) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onTickPreset: (p: TickPreset) => void;
};

export default function TimelineToolbar({
  rangeLabel,
  dayLabel,
  timeLabel,
  dayKeys,
  dayCounts,
  viewAllDates,
  activeDay,
  timeWindow,
  customStart,
  customEnd,
  tickPreset,
  dateMenu,
  timeMenu,
  onToggleDateMenu,
  onToggleTimeMenu,
  onSelectDay,
  onSelectWindow,
  onCustomStart,
  onCustomEnd,
  onFit,
  onZoomIn,
  onZoomOut,
  onTickPreset,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <button
          type="button"
          aria-label="Choose timeline date"
          onClick={onToggleDateMenu}
          className={`shrink-0 rounded-md px-1.5 py-0.5 ${mono} text-[11px] tracking-[0.12em] text-slate-700 hover:bg-slate-100`}
        >
          {dayLabel}
        </button>
        {dateMenu && (
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[220px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => onSelectDay("all")}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] ${viewAllDates ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
            >
              All Dates
              <span className={`${mono} text-[10px] text-slate-400`}>{dayKeys.length}</span>
            </button>
            {dayKeys.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDay(day)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] ${!viewAllDates && activeDay === day ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {formatDayHeading(day)}
                <span className={`${mono} text-[10px] text-slate-400`}>{dayCounts[day] ?? 0}</span>
              </button>
            ))}
            {!dayKeys.length && (
              <div className="px-3 py-2 text-[12px] text-slate-400">No dated events yet</div>
            )}
          </div>
        )}
      </div>
      <span className="text-[11px] text-slate-300">·</span>
      <div className="relative">
        <button
          type="button"
          aria-label="Choose time window"
          onClick={onToggleTimeMenu}
          className={`shrink-0 rounded-md px-1.5 py-0.5 ${mono} text-[11px] tracking-[0.12em] text-slate-700 hover:bg-slate-100`}
        >
          {timeLabel}
        </button>
        {timeMenu && (
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            {TIME_WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelectWindow(opt.id)}
                className={`flex w-full px-3 py-2 text-left text-[12.5px] ${timeWindow === opt.id ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {opt.label}
              </button>
            ))}
            {timeWindow === "custom" && (
              <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2">
                <input type="time" value={customStart} onChange={(e) => onCustomStart(e.target.value)} className="h-8 rounded-md border border-slate-200 px-1 text-[12px]" />
                <span className="text-[11px] text-slate-400">→</span>
                <input type="time" value={customEnd} onChange={(e) => onCustomEnd(e.target.value)} className="h-8 rounded-md border border-slate-200 px-1 text-[12px]" />
              </div>
            )}
          </div>
        )}
      </div>
      <span className="sr-only">{rangeLabel}</span>
      <button
        type="button"
        onClick={onFit}
        className="ml-1 h-7 shrink-0 rounded-lg border border-slate-200 px-2.5 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100"
      >
        Fit to Events
      </button>
      <span className="h-4 w-px shrink-0 bg-slate-200" />
      <button type="button" aria-label="Zoom out" onClick={onZoomOut} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Zoom in" onClick={onZoomIn} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
        <Plus className="h-3.5 w-3.5" />
      </button>
      {(["15m", "1h", "4h"] as TickPreset[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onTickPreset(p)}
          className={`h-7 rounded-lg px-2 text-[11px] font-semibold ${tickPreset === p ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-100"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
