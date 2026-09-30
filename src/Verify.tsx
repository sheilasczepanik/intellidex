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
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-blue-700 shadow-lg hover:bg-blue-50"
      >
        + Extract Event
      </button>
    </div>
  );
}

export const IMAGE_OBS_CATEGORIES = [
  { id: "subject_sighting", label: "Subject Sighting", entityType: "person" as const, extract: "person" as const, role: "UNVERIFIED" },
  { id: "personal_belonging", label: "Personal Belonging", entityType: "exhibit" as const, extract: "evidence" as const, role: "UNVERIFIED" },
  { id: "vehicle", label: "Vehicle", entityType: "vehicle" as const, extract: "vehicle" as const, role: "UNVERIFIED" },
  { id: "location_marker", label: "Location Marker", entityType: "location" as const, extract: "location" as const, role: "UNVERIFIED" },
  { id: "witness", label: "Witness", entityType: "person" as const, extract: "person" as const, role: "WITNESS" },
] as const;

export type ImageObsCategoryId = (typeof IMAGE_OBS_CATEGORIES)[number]["id"];

export function ImageExtractPopover({
  x,
  y,
  previewDataUrl,
  onAdd,
  onDismiss,
}: {
  x: number;
  y: number;
  previewDataUrl: string;
  onAdd: (input: { name: string; category: ImageObsCategoryId; notes: string }) => void;
  onDismiss: () => void;
}) {
  const [name, setName] = useState("Region of interest");
  const [category, setCategory] = useState<ImageObsCategoryId>("subject_sighting");
  const [notes, setNotes] = useState("");
  const left = Math.min(window.innerWidth - 24, Math.max(24, x));
  const top = Math.min(window.innerHeight - 24, Math.max(24, y + 12));
  return (
    <div
      className="fixed z-[90] w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 rounded-[14px] border border-slate-200 bg-white p-3 shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 text-[12px] font-semibold text-slate-900">Extract from Selection</div>
      <img src={previewDataUrl} alt="" className="mb-2 max-h-24 w-full rounded-md object-contain bg-slate-100" />
      <label className="mb-2 block text-[11px] text-slate-500">
        Entity / Observation Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] text-slate-900 outline-none focus:border-blue-500"
        />
      </label>
      <label className="mb-2 block text-[11px] text-slate-500">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ImageObsCategoryId)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] text-slate-900"
        >
          {IMAGE_OBS_CATEGORIES.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </label>
      <label className="mb-3 block text-[11px] text-slate-500">
        Notes / Context
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[13px] text-slate-900 outline-none focus:border-blue-500"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDismiss} className="rounded-lg px-2.5 py-1.5 text-[12px] text-slate-500 hover:bg-slate-50">Cancel</button>
        <button
          type="button"
          onClick={() => onAdd({ name: name.trim() || "Visual observation", category, notes: notes.trim() })}
          className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700"
        >
          Add to Case
        </button>
      </div>
    </div>
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
