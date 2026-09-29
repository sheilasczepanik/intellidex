import { ArrowRight, Loader2 } from "lucide-react";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

export default function NewCaseForm({
  title,
  jurisdiction,
  incidentStart,
  incidentEnd,
  summary,
  saving,
  onTitle,
  onJurisdiction,
  onIncidentStart,
  onIncidentEnd,
  onSummary,
  onCancel,
  onSubmit,
}: {
  title: string;
  jurisdiction: string;
  incidentStart: string;
  incidentEnd: string;
  summary: string;
  saving: boolean;
  onTitle: (value: string) => void;
  onJurisdiction: (value: string) => void;
  onIncidentStart: (value: string) => void;
  onIncidentEnd: (value: string) => void;
  onSummary: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-10 pb-20 pt-16">
      <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>NEW CASE / LOCAL VAULT</div>
      <h1 className="mb-2 text-[34px] font-semibold leading-tight tracking-tight">Create case</h1>
      <p className="mb-8 max-w-[52ch] text-[14px] leading-relaxed text-slate-500">
        Open a workspace immediately. Evidence, entities, and extraction happen on Overview after you create the case.
      </p>
      <form
        className="rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Case Title</label>
        <input
          required
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="The Harbor Ledger"
          className={`${inputCls} mb-4 h-11 text-[15px] font-semibold`}
        />
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Jurisdiction / Authority</label>
        <input
          value={jurisdiction}
          onChange={(e) => onJurisdiction(e.target.value)}
          placeholder="Three port authorities"
          className={`${inputCls} mb-4 h-11 text-[14px]`}
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Primary Incident Start</label>
            <input
              type="date"
              value={incidentStart}
              onChange={(e) => onIncidentStart(e.target.value)}
              className={`${inputCls} h-11 text-[14px]`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Primary Incident End</label>
            <input
              type="date"
              value={incidentEnd}
              onChange={(e) => onIncidentEnd(e.target.value)}
              className={`${inputCls} h-11 text-[14px]`}
            />
          </div>
        </div>
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
          Brief Focus / Case Summary <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={summary}
          onChange={(e) => onSummary(e.target.value)}
          placeholder="What this investigation is about"
          className={`${inputCls} mb-6 h-[104px] resize-none py-2.5 text-[13.5px] leading-relaxed`}
        />
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            Create & Open Workspace
          </button>
        </div>
      </form>
    </div>
  );
}
