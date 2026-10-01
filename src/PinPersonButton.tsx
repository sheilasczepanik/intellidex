import { Pin } from "lucide-react";

export default function PinPersonButton({
  pinned,
  onToggle,
  disabled,
}: {
  pinned: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={pinned ? "Unpin person" : "Pin person"}
      title={pinned ? "Unpin from left rail" : "Pin to left rail"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
        pinned ? "text-blue-700 hover:bg-blue-50" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      <Pin className={`h-3.5 w-3.5 ${pinned ? "fill-blue-600" : ""}`} />
    </button>
  );
}
