import { useState } from "react";
import { categoryLabel, getCategoryColor } from "./utils/categoryColors";
import { VERIFY_CATEGORIES } from "./lib/extractSchema";

const mono = "font-mono";

/** Category pill for Verify extraction cards — same tokens as timeline and dossier. */
export function VerifyCategoryBadge({ category }: { category: string }) {
  if (!category.trim()) return null;
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${getCategoryColor(category, "badge")}`}>
      {categoryLabel(category)}
    </span>
  );
}

export function ExtractSelectionTip({
  x, y, onExtract,
}: {
  x: number;
  y: number;
  onExtract: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed z-[80] -translate-x-1/2 -translate-y-full"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={onExtract}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-amber-950 shadow-lg hover:bg-amber-50"
      >
        + Log as Evidence
      </button>
    </div>
  );
}

export const MANUAL_EVIDENCE_CATEGORIES = [
  { id: "subject_sighting", label: "Subject Sighting" },
  { id: "location", label: "Location / Address" },
  { id: "vehicle", label: "Vehicle / Plate" },
  { id: "physical_description", label: "Physical Description" },
  { id: "timeline", label: "Timeline Event" },
  { id: "contact", label: "Contact" },
] as const;

export type ManualLogCategoryId = (typeof MANUAL_EVIDENCE_CATEGORIES)[number]["id"];

export function LogEvidenceModal({
  quote,
  pageNumber,
  previewDataUrl,
  onSave,
  onDismiss,
}: {
  quote: string;
  pageNumber?: number;
  previewDataUrl?: string;
  onSave: (input: { quote: string; category: ManualLogCategoryId; notes: string; pageNumber?: number }) => void;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(quote);
  const [category, setCategory] = useState<ManualLogCategoryId>("subject_sighting");
  const [notes, setNotes] = useState("");
  const [page, setPage] = useState(pageNumber ? String(pageNumber) : "");
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="log-evidence-title">
      <div className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-5 shadow-xl">
        <h2 id="log-evidence-title" className="text-[16px] font-semibold text-slate-900">Log as Evidence</h2>
        <p className="mt-1 text-[12.5px] text-slate-500">This observation is stored on the case immediately and tagged as a manual highlight.</p>
        {previewDataUrl ? (
          <img src={previewDataUrl} alt="" className="mt-3 max-h-28 w-full rounded-md bg-slate-100 object-contain" />
        ) : null}
        <label className="mt-3 block text-[11px] text-slate-500">
          Extracted Content / Quote
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-blue-500"
          />
        </label>
        <label className="mt-2 block text-[11px] text-slate-500">
          Page Number
          <input
            value={page}
            onChange={(e) => setPage(e.target.value)}
            inputMode="numeric"
            placeholder="Auto-detected when available"
            className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-900 outline-none focus:border-blue-500"
          />
        </label>
        <label className="mt-2 block text-[11px] text-slate-500">
          Evidence Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ManualLogCategoryId)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-900"
          >
            {MANUAL_EVIDENCE_CATEGORIES.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="mt-2 block text-[11px] text-slate-500">
          Relevance / Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] text-slate-900 outline-none focus:border-blue-500"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-2 text-[13px] text-slate-500 hover:bg-slate-50">Cancel</button>
          <button
            type="button"
            onClick={() => onSave({
              quote: text.trim() || quote,
              category,
              notes: notes.trim(),
              pageNumber: page ? Number.parseInt(page, 10) || pageNumber : pageNumber,
            })}
            className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-blue-700"
          >
            Save Evidence
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManualObservationBadge() {
  return (
    <span className={`inline-flex items-center rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-violet-800`}>
      Manual Observation
    </span>
  );
}

export function AiExtractedBadge() {
  return (
    <span className={`inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-slate-600`}>
      AI-Extracted
    </span>
  );
}

export function VerifyConfidenceChip({ confidence }: { confidence: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  const tier = pct >= 85
    ? "text-emerald-700 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
    : pct >= 60
      ? "text-amber-700 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
      : "text-rose-700 bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800";
  return (
    <span
      title={`Claude confidence: ${pct}% based on verbatim match in source report`}
      className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${tier}`}
    >
      AI Match: {pct}%
    </span>
  );
}

export { VERIFY_CATEGORIES };
