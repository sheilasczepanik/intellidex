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
