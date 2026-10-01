import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Globe, Image as ImageIcon, Plus } from "lucide-react";
import type { EvidenceRecord } from "./db";
import { inferSourceType } from "./types";

function cleanTitle(name: string) {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  try {
    return decodeURIComponent(base).replace(/[+_]+/g, " ").replace(/\s+/g, " ").trim() || name;
  } catch {
    return base.replace(/[+_]+/g, " ").replace(/\s+/g, " ").trim() || name;
  }
}

function typeBadge(ev: EvidenceRecord) {
  const kind = inferSourceType(ev);
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "IMAGE";
  if (kind === "web_article") return "WEB";
  if (kind === "external_intel") return "TIP";
  return "TEXT";
}

function isImported(ev: EvidenceRecord) {
  const kind = inferSourceType(ev);
  return kind === "web_article" || kind === "external_intel" || Boolean(ev.sourceUrl);
}

function SourceIcon({ evidence }: { evidence: EvidenceRecord }) {
  const kind = inferSourceType(evidence);
  if (kind === "web_article" || kind === "external_intel") return <Globe className="h-4 w-4 shrink-0 text-blue-600" />;
  if (kind === "image") return <ImageIcon className="h-4 w-4 shrink-0 text-slate-500" />;
  return <FileText className="h-4 w-4 shrink-0 text-slate-500" />;
}

export default function VerifySourceSwitcher({
  files,
  activeId,
  extractedIds,
  onSelect,
  onUpload,
  onAddLink,
}: {
  files: EvidenceRecord[];
  activeId: string | null;
  extractedIds: Set<string>;
  onSelect: (id: string) => void;
  onUpload: () => void;
  onAddLink: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = files.find((file) => file.id === activeId) ?? files[0] ?? null;
  const library = files.filter((file) => !isImported(file));
  const imported = files.filter((file) => isImported(file));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const row = (file: EvidenceRecord) => {
    const extracted = extractedIds.has(file.id);
    return (
      <button
        key={file.id}
        type="button"
        onClick={() => {
          onSelect(file.id);
          setOpen(false);
        }}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 ${file.id === active?.id ? "bg-blue-50" : ""}`}
      >
        <SourceIcon evidence={file} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-slate-900">{cleanTitle(file.fileName)}</span>
          <span className="font-mono text-[10px] text-slate-500">
            {typeBadge(file)}{file.pageCount ? ` · ${file.pageCount} pages` : ""}
          </span>
        </span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] ${extracted ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          {extracted ? "Extracted" : "Unprocessed"}
        </span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="mb-1 font-mono text-[10px] tracking-[0.14em] text-slate-400">ACTIVE SOURCE</div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-[10px] border border-slate-300 bg-white px-2.5 text-left"
      >
        {active ? <SourceIcon evidence={active} /> : <FileText className="h-4 w-4 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">
          {active ? cleanTitle(active.fileName) : "No source selected"}
        </span>
        {active ? (
          <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
            {typeBadge(active)}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[min(420px,60vh)] overflow-auto rounded-[12px] border border-slate-200 bg-white shadow-lg">
          <div className="px-3 pb-1 pt-2 font-mono text-[10px] tracking-[0.12em] text-slate-400">Pre-Loaded Case Files</div>
          {library.length ? library.map(row) : <p className="px-3 py-2 text-[12px] text-slate-400">No case files yet.</p>}
          <div className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 font-mono text-[10px] tracking-[0.12em] text-slate-400">Imported Web & Tips</div>
          {imported.length ? imported.map(row) : <p className="px-3 py-2 text-[12px] text-slate-400">No articles or tips yet.</p>}
          <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onUpload();
              }}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-slate-300 text-[12.5px] font-semibold text-slate-800 hover:border-blue-500 hover:text-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />Upload New Document
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAddLink();
              }}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-slate-300 text-[12.5px] font-semibold text-slate-800 hover:border-blue-500 hover:text-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />Link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
