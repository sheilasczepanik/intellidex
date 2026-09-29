const mono = "font-mono";

export default function MediaProvenanceBadge({
  show,
  onPromote,
}: {
  show?: boolean;
  onPromote?: () => void;
}) {
  if (!show) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.04em] text-amber-900`}>
        Reported by Media (Uncorroborated)
      </span>
      {onPromote && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPromote();
          }}
          className="inline-flex items-center rounded-md border border-amber-400 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          Promote to Verified Entity
        </button>
      )}
    </div>
  );
}
