import { TriangleAlert, X } from "lucide-react";
import type { TimelineEventRecord } from "./db";

const mono = "font-mono";

export default function TimelineConflictInspector({
  open,
  pair,
  events,
  onClose,
  onMerge,
  onReassignTime,
  onFlagUnverified,
}: {
  open: boolean;
  pair: { aId: string; bId: string; label: string; detail: string } | null;
  events: TimelineEventRecord[];
  onClose: () => void;
  onMerge: (keepId: string, dropId: string) => void;
  onReassignTime: (eventId: string) => void;
  onFlagUnverified: (aId: string, bId: string) => void;
}) {
  if (!open || !pair) return null;
  const a = events.find((row) => row.id === pair.aId);
  const b = events.find((row) => row.id === pair.bId);
  const card = (row?: TimelineEventRecord) => (
    <div className="min-w-0 flex-1 rounded-[12px] border border-slate-200 bg-slate-50 p-3">
      <div className={`${mono} text-[10px] tracking-[0.08em] text-slate-500`}>{row ? new Date(row.timestamp).toLocaleString() : "—"}</div>
      <div className="mt-1 text-[13.5px] font-semibold leading-snug text-slate-900">{row?.title || "Missing event"}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">{row?.description || "No description."}</p>
      <div className="mt-2 text-[11px] text-slate-500">{row?.sourceCitation?.sourceName || row?.sourceDocId || "No source"}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 p-3 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-amber-800">
              <TriangleAlert className="h-4 w-4" />
              <span className={`${mono} text-[11px] tracking-[0.08em]`}>{pair.label.toUpperCase()}</span>
            </div>
            <p className="mt-1 text-[14px] font-semibold text-slate-900">{pair.detail}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">{card(a)}{card(b)}</div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!a || !b}
            onClick={() => { if (a && b) onMerge(a.id, b.id); }}
            className="h-9 rounded-lg bg-slate-900 px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            Merge
          </button>
          <button
            type="button"
            disabled={!b}
            onClick={() => { if (b) onReassignTime(b.id); }}
            className="h-9 rounded-lg border border-slate-300 px-3 text-[12.5px] font-medium text-slate-700"
          >
            Reassign Time
          </button>
          <button
            type="button"
            onClick={() => onFlagUnverified(pair.aId, pair.bId)}
            className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-[12.5px] font-medium text-amber-800"
          >
            Flag Unverified
          </button>
        </div>
      </div>
    </div>
  );
}
