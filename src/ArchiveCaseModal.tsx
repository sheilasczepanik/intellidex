import { useId } from "react";
import { Archive, X } from "lucide-react";

type Props = {
  open: boolean;
  caseTitle: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function ArchiveCaseModal({
  open,
  caseTitle,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const titleId = useId();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="pr-4 text-[17px] font-semibold tracking-tight">
            Archive this case?
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        </div>
        <p className="mb-6 text-[13.5px] leading-relaxed text-slate-600">
          Archive <span className="font-semibold text-slate-900">{caseTitle}</span>? It will move to your Archived tab on the Hub. You can restore it anytime.
        </p>
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { void onConfirm(); }}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}
