import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { updateCase, type CaseRecord } from "./db";

const mono = "font-mono";

export default function WorkingTheory({ activeCase }: { activeCase: CaseRecord }) {
  const [notes, setNotes] = useState(activeCase.workingNotes ?? "");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setNotes(activeCase.workingNotes ?? "");
  }, [activeCase.id]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (notes === (activeCase.workingNotes ?? "")) return;
      void updateCase(activeCase.id, { workingNotes: notes }).then(() => {
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1200);
      });
    }, 450);
    return () => window.clearTimeout(handle);
  }, [notes, activeCase.id, activeCase.workingNotes]);

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-10">
      <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>
        {activeCase.id} / WORKING THEORY
      </div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">Working Theory</h1>
        <span className={`${mono} text-[11px] ${savedFlash ? "text-emerald-700" : "text-slate-500"}`}>
          {savedFlash ? (
            <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />SAVED</span>
          ) : "AUTOSAVE · INDEXEDDB"}
        </span>
      </div>
      <p className="mb-6 max-w-[62ch] text-[14px] leading-relaxed text-slate-600">
        Record hypotheses, open leads, and investigative impressions for {activeCase.title}. This notebook is stored locally with the case and is no longer shown on Overview.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Initial impressions, open leads, hypotheses…"
        aria-label="Working theory notes"
        className="min-h-[min(62vh,560px)] w-full resize-y rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-[14.5px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12"
      />
    </div>
  );
}
