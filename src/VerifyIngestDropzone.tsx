import { useRef, useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.csv";

export default function VerifyIngestDropzone({
  busy,
  indexedFiles,
  onFiles,
  onPickIndexed,
}: {
  busy?: boolean;
  indexedFiles: { id: string; fileName: string }[];
  onFiles: (files: FileList | File[]) => void;
  onPickIndexed: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | File[] | null) => {
    if (!list || busy) return;
    const files = [...list];
    if (files.length) onFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="w-full max-w-[420px]" data-verify-ingest="">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => take(e.target.files)}
      />
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={`rounded-[14px] border-2 border-dashed px-5 py-8 text-center transition-colors ${
          over ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-white"
        } ${busy ? "opacity-70" : ""}`}
      >
        <CloudUpload className="mx-auto mb-3 h-8 w-8 text-slate-400" />
        <div className="text-[15px] font-semibold text-slate-900">Ingest New Document for Extraction</div>
        <p className="mx-auto mt-1.5 max-w-[36ch] text-[12.5px] leading-relaxed text-slate-500">
          Drop an incident report, dispatch log, warrant PDF, or scanned flyer to extract entities directly
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? "Extracting…" : "Browse Files"}
        </button>
        <p className="mt-2 text-[11px] text-slate-400">PDF, PNG, JPG, TXT, CSV</p>
      </div>
      {indexedFiles.length > 0 && (
        <label className="mt-3 block text-center">
          <span className="mb-1.5 block text-[12px] font-medium text-slate-600">Or select a file from Intake Staging Queue</span>
          <select
            disabled={busy}
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              e.currentTarget.value = "";
              if (id) onPickIndexed(id);
            }}
            className="w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-blue-600"
          >
            <option value="" disabled>
              Processed files in Intake…
            </option>
            {indexedFiles.map((file) => (
              <option key={file.id} value={file.id}>{file.fileName}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
