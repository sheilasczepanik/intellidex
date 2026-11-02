import type { DemoDossierId } from "./data/demoDossiers";

export default function DemoDatasets({
  busy,
  onLoad,
}: {
  busy?: boolean;
  onLoad: (id: DemoDossierId) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
      <span className="font-mono text-xs uppercase tracking-wider text-slate-500">Demo Datasets:</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onLoad("MM_1")}
        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
      >
        📄 UMPD Narrative (38 Pages)
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onLoad("CONFLICT_DISPATCH")}
        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
      >
        ⚠️ Location & Contradiction Log
      </button>
    </div>
  );
}
