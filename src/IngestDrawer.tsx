import { useState } from "react";
import { Check, CloudUpload, Globe, Loader2, Scale, Sparkles, TriangleAlert, X } from "lucide-react";
import type { EvidenceRecord } from "./db";
import { formatBytes } from "./db";
import { EVIDENCE_ACCEPT } from "./lib/pdfText";
import { parseArticleUrl } from "./lib/scrapeClient";
import { MEDIA_CUSTODY_BANNER } from "./lib/sourceTier";
import { ingestStageLabel, type IngestJob } from "./lib/ingestProgress";
import type { ExtractedEvent, ExtractedRelationship, ExtractedRosterEntity, ExtractBundle } from "./lib/extractSchema";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

const STEPS = [
  "Extracting text from document...",
  "Extracting people, locations, dates, and exhibits...",
  "Generating timeline events...",
] as const;

function stepIndex(job: IngestJob | null | undefined) {
  if (!job) return -1;
  if (job.stage === "pdf" || job.stage === "render") return 0;
  if (job.stage === "claude") return 1;
  if (job.stage === "events" || job.stage === "done") return 2;
  return 0;
}

export type ExtractPreview = {
  evidenceId: string;
  fileName: string;
  entities: ExtractedRosterEntity[];
  events: ExtractedEvent[];
  relationships?: ExtractedRelationship[];
  usedFallback?: boolean;
  autoApplied?: boolean;
  bundle?: ExtractBundle;
};

export default function IngestDrawer({
  open,
  busy,
  error,
  staged,
  ingestJob,
  extractPreview,
  selectedNames,
  onToggleName,
  onClose,
  onDropFiles,
  onPaste,
  onImportUrl,
  onExtract,
  onAcceptRoster,
}: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  staged: EvidenceRecord[];
  ingestJob?: IngestJob | null;
  extractPreview?: ExtractPreview | null;
  selectedNames: Set<string>;
  onToggleName: (name: string) => void;
  onClose: () => void;
  onDropFiles: (files: FileList | File[]) => void | Promise<void>;
  onPaste: (text: string, kind?: "official" | "editorial") => void | Promise<void>;
  onImportUrl: (url: string, onProgress: (stage: "scraping" | "staging") => void) => Promise<void>;
  onExtract: (evidenceId: string) => void | Promise<void>;
  onAcceptRoster: () => void | Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [paste, setPaste] = useState("");
  const [editorial, setEditorial] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [scrapeStage, setScrapeStage] = useState<"idle" | "scraping" | "staging">("idle");
  const [tab, setTab] = useState<"official" | "press">("official");
  const scrapeBusy = scrapeStage !== "idle";
  const extracting = Boolean(ingestJob && ingestJob.stage !== "done");
  const activeStep = stepIndex(ingestJob);
  const extractTarget = staged[0]?.id;

  if (!open) return null;

  const takeFiles = async (list: FileList | File[] | null) => {
    if (!list || (Array.isArray(list) ? list.length === 0 : list.length === 0)) return;
    await onDropFiles([...list]);
  };

  const fetchArticle = async () => {
    const parsed = parseArticleUrl(articleUrl);
    if (!parsed) {
      setUrlError("Enter a valid http:// or https:// URL.");
      return;
    }
    setUrlError(null);
    setScrapeStage("scraping");
    try {
      await onImportUrl(parsed, setScrapeStage);
      setArticleUrl("");
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Unable to scrape that link. Paste the article copy below.");
    } finally {
      setScrapeStage("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[460px] flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <div>
            <div className="flex items-center gap-2">
              <div className={`${mono} text-[10px] tracking-[0.14em] text-slate-500`}>INGEST EVIDENCE</div>
              {extracting ? (
                <span className={`inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 ${mono} text-[9px] tracking-[0.1em] text-blue-800`}>
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />EXTRACTING
                </span>
              ) : extractPreview?.autoApplied ? (
                <span className={`rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 ${mono} text-[9px] tracking-[0.1em] text-emerald-800`}>INDEXED</span>
              ) : extractPreview ? (
                <span className={`rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 ${mono} text-[9px] tracking-[0.1em] text-amber-900`}>REVIEW</span>
              ) : null}
            </div>
            <div className="text-[15px] font-semibold tracking-tight">Add sources to this case</div>
          </div>
          <button type="button" aria-label="Close ingest drawer" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}
            </div>
          )}

          {extracting && (
            <div className="rounded-[12px] border border-blue-200 bg-blue-50/70 px-3.5 py-3">
              <div className={`mb-2 ${mono} text-[10px] tracking-[0.12em] text-blue-700`}>AI REVIEW</div>
              <ol className="space-y-2">
                {STEPS.map((label, i) => {
                  const on = i === activeStep;
                  const done = i < activeStep;
                  return (
                    <li key={label} className={`flex items-start gap-2 text-[12.5px] ${on ? "font-semibold text-blue-900" : done ? "text-slate-600" : "text-slate-400"}`}>
                      {on ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${done ? "text-emerald-600" : "text-slate-300"}`} />}
                      {label}
                    </li>
                  );
                })}
              </ol>
              {ingestJob ? <p className="mt-2 text-[11.5px] text-blue-800">{ingestStageLabel(ingestJob)}</p> : null}
            </div>
          )}

          {extractPreview && !extracting && (
            <div className="rounded-[12px] border border-emerald-200 bg-emerald-50/50 p-3.5">
              <div className="mb-2 text-[13.5px] font-semibold">Extracted from {extractPreview.fileName}</div>
              {extractPreview.usedFallback && (
                <p className="mb-2 text-[12px] text-amber-800">Model returned an empty set. Showing heuristic names, dates, and addresses — already saved to this case.</p>
              )}
              {extractPreview.autoApplied && (
                <p className="mb-2 text-[12px] text-emerald-800">Entities and chronology were written to the case roster.</p>
              )}
              <ul className="mb-3 max-h-48 space-y-1.5 overflow-y-auto">
                {extractPreview.entities.map((ent) => {
                  const on = selectedNames.has(ent.name);
                  return (
                    <li key={`${ent.type}-${ent.name}`}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-white/80">
                        <input type="checkbox" checked={on} onChange={() => onToggleName(ent.name)} className="mt-1" />
                        <span>
                          <span className="text-[13px] font-medium">{ent.name}</span>
                          <span className={`ml-1.5 ${mono} text-[10px] text-slate-500`}>{ent.type} · {ent.classification}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {extractPreview.events.length > 0 && (
                <p className="mb-3 text-[12px] text-slate-600">{extractPreview.events.length} timeline event{extractPreview.events.length === 1 ? "" : "s"} ready to plot.</p>
              )}
              <button
                type="button"
                onClick={() => void onAcceptRoster()}
                disabled={!selectedNames.size && !extractPreview.events.length}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />{extractPreview.autoApplied ? "Close review" : "Accept into Case Roster"}
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setTab("official")}
              className={`rounded-[8px] px-2 py-2 text-[11.5px] font-semibold ${tab === "official" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              Official Evidence & Court Records
            </button>
            <button
              type="button"
              onClick={() => setTab("press")}
              className={`rounded-[8px] px-2 py-2 text-[11.5px] font-semibold ${tab === "press" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              External Intelligence & Press
            </button>
          </div>

          {tab === "press" && (
            <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-950">
              {MEDIA_CUSTODY_BANNER}
            </div>
          )}

          {tab === "official" ? (
            <>
              <label
                onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void takeFiles(e.dataTransfer.files);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-4 py-8 text-center transition-colors ${
                  dragging ? "border-blue-600 bg-blue-50" : "border-slate-300 bg-slate-50/70 hover:border-slate-400"
                }`}
              >
                <input
                  type="file"
                  accept={EVIDENCE_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => { void takeFiles(e.target.files); e.target.value = ""; }}
                />
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-blue-600">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                </div>
                <div className="text-[14px] font-semibold">{dragging ? "Release to register" : "Drop PDFs, warrants, or transcripts"}</div>
                <p className={`mt-1 ${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}>STAGES LOCALLY · THEN EXTRACT WITH AI</p>
              </label>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Scale className="h-3.5 w-3.5 text-slate-600" />
                  <h3 className="text-[13.5px] font-semibold">Official narrative</h3>
                </div>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={5}
                  placeholder="Paste police narrative, interview notes, or field logs…"
                  className={`${inputCls} resize-y py-2.5 text-[13px] leading-relaxed`}
                />
                <button
                  type="button"
                  disabled={!paste.trim() || busy}
                  onClick={() => {
                    const text = paste;
                    setPaste("");
                    void onPaste(text, "official");
                  }}
                  className="mt-2 inline-flex h-9 items-center rounded-[10px] bg-slate-900 px-3.5 text-[12.5px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  Add to staging
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-amber-700" />
                  <h3 className="text-[13.5px] font-semibold">Web Link / Article</h3>
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    type="url"
                    value={articleUrl}
                    onChange={(e) => { setArticleUrl(e.target.value); if (urlError) setUrlError(null); }}
                    placeholder="https://"
                    className={`${inputCls} h-10 text-[13px]`}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void fetchArticle(); } }}
                    disabled={scrapeBusy || busy}
                  />
                  <button
                    type="button"
                    disabled={scrapeBusy || busy || !articleUrl.trim()}
                    onClick={() => void fetchArticle()}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-slate-900 px-3 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
                  >
                    {scrapeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                    {scrapeStage === "staging" ? "Staging…" : scrapeStage === "scraping" ? "Scraping…" : "Fetch & Stage"}
                  </button>
                </div>
                {urlError && <p className="mt-2 text-[12px] text-amber-800">{urlError}</p>}
              </div>
              <div>
                <h3 className="mb-2 text-[13.5px] font-semibold">Editorial narrative</h3>
                <textarea
                  value={editorial}
                  onChange={(e) => setEditorial(e.target.value)}
                  rows={5}
                  placeholder="Paste news copy, press notes, or open-source reporting…"
                  className={`${inputCls} resize-y py-2.5 text-[13px] leading-relaxed`}
                />
                <button
                  type="button"
                  disabled={!editorial.trim() || busy}
                  onClick={() => {
                    const text = editorial;
                    setEditorial("");
                    void onPaste(text, "editorial");
                  }}
                  className="mt-2 inline-flex h-9 items-center rounded-[10px] border border-amber-400 bg-amber-50 px-3.5 text-[12.5px] font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-40"
                >
                  Add to staging
                </button>
              </div>
            </>
          )}

          {staged.length > 0 && (
            <div>
              <div className={`mb-2 ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>STAGING</div>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-[10px] border border-slate-200">
                {staged.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{row.originalFileName || row.fileName}</div>
                      <div className="text-[11.5px] text-slate-500">{formatBytes(row.byteSize ?? row.fileSize) || row.fileType}</div>
                    </div>
                    <button
                      type="button"
                      disabled={extracting}
                      onClick={() => void onExtract(row.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-40"
                    >
                      <Sparkles className="h-3 w-3" /> Extract
                    </button>
                  </li>
                ))}
              </ul>
              {extractTarget && (
                <button
                  type="button"
                  disabled={extracting || busy}
                  onClick={() => void onExtract(extractTarget)}
                  className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Extract Entities & Chronology with AI
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
