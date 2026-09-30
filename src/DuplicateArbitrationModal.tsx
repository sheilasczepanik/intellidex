import type { DupDecision, DupMatch } from "./lib/duplicates";

export default function DuplicateArbitrationModal({
  match,
  onDecide,
}: {
  match: DupMatch;
  onDecide: (decision: DupDecision) => void;
}) {
  const fields = [
    ["Title", match.existing.title, match.incoming.title],
    ["Context", match.existing.subtitle, match.incoming.subtitle],
    ["Detail", match.existing.body, match.incoming.body],
    ["Provenance", match.existing.meta, match.incoming.meta],
  ] as const;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dup-title">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-[16px] border border-amber-300 bg-white p-5 shadow-2xl">
        <div className="mb-1 font-mono text-[11px] tracking-[0.14em] text-amber-800">POTENTIAL DUPLICATE DETECTED</div>
        <h2 id="dup-title" className="text-[18px] font-semibold text-slate-900">
          This {match.kind} already exists in the case vault
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">Compare the stored record with the incoming one, then keep one copy or merge citations.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <article className="rounded-[12px] border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 font-mono text-[10px] tracking-[0.12em] text-slate-500">EXISTING RECORD</div>
            {fields.map(([label, left, right]) => (
              <div key={`l-${label}`} className="mb-2">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                <p className={`whitespace-pre-wrap text-[13px] text-slate-800 ${left !== right ? "font-semibold" : ""}`}>{left || "—"}</p>
              </div>
            ))}
          </article>
          <article className="rounded-[12px] border border-blue-200 bg-blue-50/50 p-3">
            <div className="mb-2 font-mono text-[10px] tracking-[0.12em] text-blue-700">INCOMING NEW DATA</div>
            {fields.map(([label, left, right]) => (
              <div key={`r-${label}`} className="mb-2">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                <p className={`whitespace-pre-wrap text-[13px] text-slate-800 ${left !== right || match.incoming.newer ? "font-semibold" : ""}`}>
                  {right || "—"}
                  {right && left !== right ? <span className="ml-1 text-[10.5px] font-medium text-blue-700">newer / differs</span> : null}
                </p>
              </div>
            ))}
          </article>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onDecide("keep_existing")} className="rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">
            Keep Existing / Reject New
          </button>
          <button type="button" onClick={() => onDecide("keep_new")} className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-800 hover:bg-rose-100">
            Keep New / Delete Old
          </button>
          <button type="button" onClick={() => onDecide("merge")} className="rounded-[10px] bg-blue-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-blue-700">
            Link / Merge Both
          </button>
        </div>
      </div>
    </div>
  );
}
