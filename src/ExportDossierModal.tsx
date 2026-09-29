import { useState } from "react";
import { FileDown, Loader2, ShieldCheck, X } from "lucide-react";
import type { DossierExportFormat, DossierExportOptions } from "./lib/DossierPdfGenerator";

const SECTIONS: { key: keyof Pick<DossierExportOptions, "cover" | "custody" | "chronology" | "contradictions" | "exhibits">; label: string }[] = [
  { key: "cover", label: "Executive Cover Page" },
  { key: "custody", label: "Evidence Inventory" },
  { key: "chronology", label: "Verified Chronology" },
  { key: "contradictions", label: "Resolved/Unresolved Contradictions" },
  { key: "exhibits", label: "Annotated Source Exhibits" },
];

export default function ExportDossierModal({
  caseTitle,
  caseId,
  busy,
  error,
  onClose,
  onGenerate,
}: {
  caseTitle: string;
  caseId: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onGenerate: (opts: DossierExportOptions) => void | Promise<void>;
}) {
  const [format, setFormat] = useState<DossierExportFormat>("pdf");
  const [cover, setCover] = useState(true);
  const [custody, setCustody] = useState(true);
  const [chronology, setChronology] = useState(true);
  const [contradictions, setContradictions] = useState(true);
  const [exhibits, setExhibits] = useState(true);
  const [redact, setRedact] = useState(false);
  const flags = { cover, custody, chronology, contradictions, exhibits };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-labelledby="export-dossier-title"
        className="w-full max-w-[560px] overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="mb-1 font-mono text-[10.5px] tracking-[0.12em] text-slate-500">{caseId} / EXPORT</div>
            <h2 id="export-dossier-title" className="text-[18px] font-semibold tracking-tight">Export Official INTELLIDEX</h2>
            <p className="mt-1 text-[12.5px] text-slate-500">{caseTitle} — generated locally, never uploaded.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div>
            <div className="mb-2 font-mono text-[10.5px] tracking-[0.12em] text-slate-500">FORMAT</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setFormat("pdf")}
                className={`rounded-[12px] border px-3.5 py-3 text-left ${format === "pdf" ? "border-blue-600 bg-blue-50 ring-[3px] ring-blue-600/15" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="text-[13.5px] font-semibold">Official Evidentiary PDF Briefing</div>
                <div className="mt-1 text-[11.5px] text-slate-500">Primary court pack with page numbers and custody log.</div>
              </button>
              <button
                type="button"
                onClick={() => setFormat("json")}
                className={`rounded-[12px] border px-3.5 py-3 text-left ${format === "json" ? "border-blue-600 bg-blue-50 ring-[3px] ring-blue-600/15" : "border-slate-200 hover:border-slate-300"}`}
              >
                <div className="text-[13.5px] font-semibold">Signed Raw JSON Archive</div>
                <div className="mt-1 text-[11.5px] text-slate-500">Structured case dump with source type and date added.</div>
              </button>
            </div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10.5px] tracking-[0.12em] text-slate-500">INCLUDE</div>
            <div className="space-y-2">
              {SECTIONS.map((s) => (
                <label key={s.key} className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={flags[s.key]}
                    onChange={(e) => {
                      const on = e.target.checked;
                      if (s.key === "cover") setCover(on);
                      if (s.key === "custody") setCustody(on);
                      if (s.key === "chronology") setChronology(on);
                      if (s.key === "contradictions") setContradictions(on);
                      if (s.key === "exhibits") setExhibits(on);
                    }}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-slate-200 bg-slate-50 px-3.5 py-3 text-[13px] text-slate-700">
            <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-blue-600" />
            <span>
              <span className="font-semibold">Apply Visual Redactions to Attached Exhibits</span>
              <span className="mt-0.5 block text-[12px] text-slate-500">Mask exhibit images and strip phone/email patterns from quoted text.</span>
            </span>
          </label>
          {error && (
            <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <button type="button" onClick={onClose} className="h-9 rounded-[10px] border border-slate-300 px-3.5 text-[13px] text-slate-600 hover:border-slate-400">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onGenerate({ format, cover, custody, chronology, contradictions, exhibits, redact })}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : format === "pdf" ? <FileDown className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Generate Briefing
          </button>
        </div>
      </div>
    </div>
  );
}
