import { FileSearch, Image as ImageIcon, Link2 } from "lucide-react";

export default function IngestChooser({
  onInvestigative,
  onArchive,
  onDismiss,
}: {
  onInvestigative: () => void;
  onArchive: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="ingest-chooser-title">
      <div className="w-full max-w-lg rounded-[16px] border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 id="ingest-chooser-title" className="text-[17px] font-semibold text-slate-900">Add to this case</h2>
        <p className="mt-1 text-[13px] text-slate-500">Choose whether this is primary investigative material or secondary media / tips.</p>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={onInvestigative}
            className="flex items-start gap-3 rounded-[14px] border border-slate-200 bg-white p-4 text-left hover:border-blue-400 hover:bg-blue-50/40"
          >
            <FileSearch className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
            <span>
              <span className="block text-[14.5px] font-semibold text-slate-900">Ingest Investigative Records</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-slate-500">
                Warrants, affidavits, search logs, and police reports. Routes to Verify for GPT-4o extraction.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="flex items-start gap-3 rounded-[14px] border border-amber-200 bg-amber-50/60 p-4 text-left hover:border-amber-400"
          >
            <span className="mt-0.5 flex gap-1 text-amber-800">
              <ImageIcon className="h-5 w-5" />
              <Link2 className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14.5px] font-semibold text-slate-900">Archive Media & Tips</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-slate-500">
                Photos, PDFs, news links, and social posts. Stored in the Case Media Vault without opening Verify.
              </span>
            </span>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-2 text-[13px] text-slate-500 hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
