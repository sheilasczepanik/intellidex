import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import {
  formatDaySelector,
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
  eventCount: number;
  canPrevDay: boolean;
  canNextDay: boolean;
  timeWindow: TimeWindow;
  customStart: string;
  customEnd: string;
  tickPreset: TickPreset;
  dateMenu: boolean;
  timeMenu: boolean;
  onToggleDateMenu: () => void;
  onToggleTimeMenu: () => void;
  onSelectDay: (day: string | "all") => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onSelectWindow: (w: TimeWindow) => void;
  onCustomStart: (v: string) => void;
  onCustomEnd: (v: string) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onTickPreset: (p: TickPreset) => void;
};

export function TimelineHoverTip({
  entityName,
  timestamp,
  source,
  verified,
  mergeCount,
  grow,
  children,
}: {
  entityName: string;
  timestamp: number;
  source: string;
  verified: boolean;
  mergeCount?: number;
  grow?: boolean;
  children: ReactNode;
}) {
  const [tip, setTip] = useState<{ left: number; top: number; place: "top" | "bottom" } | null>(null);

  const show = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    const place = rect.top < 168 ? "bottom" : "top";
    const half = 150;
    const left = Math.min(window.innerWidth - 16 - half, Math.max(16 + half, rect.left + rect.width / 2));
    setTip({
      left,
      top: place === "top" ? rect.top - 8 : rect.bottom + 8,
      place,
    });
  };

  return (
    <span
      className={`relative min-w-0 ${grow ? "flex-1" : ""}`}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setTip(null)}
    >
      {children}
      {tip && createPortal(
        <span
          className="pointer-events-none fixed z-50 w-max max-w-[300px] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          style={{
            left: tip.left,
            top: tip.top,
            transform: tip.place === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
          }}
        >
          <span className="block max-w-[260px] text-[12.5px] font-semibold leading-snug break-words text-slate-900">{entityName}</span>
          <span className={`mt-1.5 block ${mono} text-[10.5px] text-slate-500`}>
            {new Date(timestamp).toLocaleString()}
          </span>
          <span className="mt-1 block max-w-[260px] text-[11.5px] leading-snug break-words text-slate-600">
            {source || "No source document"}
          </span>
          {mergeCount && mergeCount > 1 ? (
            <span className="mt-2 block max-w-[260px] text-[11px] leading-snug text-amber-800">
              ⚠ Duplicate entries merged ({mergeCount} citations from identical timestamp)
            </span>
          ) : null}
          <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${verified ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {verified ? "Verified" : "Unverified"}
          </span>
          <span
            className={`absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${tip.place === "top" ? "bottom-[-5px] border-r border-b" : "top-[-5px] border-l border-t"}`}
          />
        </span>,
        document.body,
      )}
    </span>
  );
}

export default function TimelineToolbar({
  rangeLabel,
  dayLabel,
  timeLabel,
  dayKeys,
  dayCounts,
  viewAllDates,
  activeDay,
  eventCount,
  canPrevDay,
  canNextDay,
  timeWindow,
  customStart,
  customEnd,
  tickPreset,
  dateMenu,
  timeMenu,
  onToggleDateMenu,
  onToggleTimeMenu,
  onSelectDay,
  onPrevDay,
  onNextDay,
  onSelectWindow,
  onCustomStart,
  onCustomEnd,
  onFit,
  onZoomIn,
  onZoomOut,
  onTickPreset,
}: Props) {
  const total = Object.values(dayCounts).reduce((sum, n) => sum + n, 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative">
        <button
          type="button"
          aria-label="Choose timeline date"
          onClick={onToggleDateMenu}
          className="inline-flex h-8 max-w-[min(22rem,calc(100vw-4rem))] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-left text-[12.5px] text-slate-800 shadow-sm transition-colors hover:border-blue-500 hover:bg-slate-50"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate font-medium">
            Date: {dayLabel} ({eventCount} {eventCount === 1 ? "event" : "events"})
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
        {dateMenu && (
          <div className="absolute left-0 top-full z-20 mt-1 w-[min(18rem,calc(100vw-1.5rem))] min-w-0 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={() => onSelectDay("all")}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] ${viewAllDates ? "bg-blue-50 font-medium text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
            >
              All dates
              <span className={`${mono} text-[10px] text-slate-500`}>{total}</span>
            </button>
            {dayKeys.map((day) => {
              const count = dayCounts[day] ?? 0;
              const active = !viewAllDates && activeDay === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] ${active ? "bg-blue-50 font-medium text-blue-800" : "text-slate-700 hover:bg-slate-50"} ${count > 0 ? "font-medium" : "opacity-70"}`}
                >
                  <span>{formatDaySelector(day)}</span>
                  <span className={`rounded-full px-2 py-0.5 ${mono} text-[10px] ${count > 0 ? "bg-slate-100 text-slate-700" : "text-slate-400"}`}>
                    {count} {count === 1 ? "event" : "events"}
                  </span>
                </button>
              );
            })}
            {!dayKeys.length && (
              <div className="px-3 py-2 text-[12px] text-slate-400">No dated events yet</div>
            )}
          </div>
        )}
      </div>
      {!viewAllDates && activeDay ? (
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            disabled={!canPrevDay}
            onClick={onPrevDay}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-blue-500 hover:bg-slate-50 disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next day"
            disabled={!canNextDay}
            onClick={onNextDay}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-blue-500 hover:bg-slate-50 disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <span className="text-[11px] text-slate-300">·</span>
      <div className="relative">
        <button
          type="button"
          aria-label="Choose time window"
          onClick={onToggleTimeMenu}
          className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-slate-700 hover:border-slate-400"
        >
          {timeLabel}
        </button>
        {timeMenu && (
          <div className="absolute left-0 top-full z-20 mt-1 w-[min(16rem,calc(100vw-1.5rem))] min-w-0 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
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
        className="ml-1 h-8 shrink-0 rounded-lg border border-slate-200 px-2.5 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100"
      >
        Fit to Events
      </button>
      <span className="h-4 w-px shrink-0 bg-slate-200" />
      <button type="button" aria-label="Zoom out" onClick={onZoomOut} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Zoom in" onClick={onZoomIn} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
        <Plus className="h-3.5 w-3.5" />
      </button>
      {(["15m", "1h", "4h"] as TickPreset[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onTickPreset(p)}
          className={`h-8 rounded-lg px-2 text-[11px] font-semibold ${tickPreset === p ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-100"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
