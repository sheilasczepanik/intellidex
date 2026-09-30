import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { ArrowRight, CloudUpload, FileText, Globe, Loader2, TriangleAlert, X } from "lucide-react";
import { db, deleteEvidence, formatBytes, type CaseRecord, type EvidenceRecord } from "./db";
import EvidenceThumb from "./EvidenceThumb";
import { calculateSHA256 } from "./lib/cryptoUtils";
import { encodeEvidenceImage, evidenceImageSrc, isImageFile } from "./lib/imageEvidence";
import {
  ingestElapsedSec, ingestPercent, ingestStageLabel, type IngestJob,
} from "./lib/ingestProgress";
import { isPdfFile, isTextFile, readFileAsDataUrl } from "./lib/pdfText";
import { parseArticleUrl } from "./lib/scrapeClient";
import { LOW_CLARITY_BADGE } from "./lib/textClarity";
import { isSecondaryEvidence, MEDIA_CUSTODY_BANNER, sourceClassLabel } from "./lib/sourceTier";
import { inferSourceType } from "./types";

const mono = "font-mono";
const SCAN_NOTE = LOW_CLARITY_BADGE;

export const STAGE_TIMEOUT_MS = 8_000;
export const STAGE_SIZE_ERROR = "Failed to stage (File exceeds size limit)";
export const STAGE_TIMEOUT_ERROR = "Staging timed out after 8 seconds.";

export class StageTimeoutError extends Error {
  constructor(message = STAGE_TIMEOUT_ERROR) {
    super(message);
    this.name = "StageTimeoutError";
  }
}

export function withStageTimeout(work: Promise<unknown>, ms = STAGE_TIMEOUT_MS): Promise<unknown> {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new StageTimeoutError()), ms);
  });
  return Promise.race([work, timeout]).finally(() => window.clearTimeout(timer));
}

export function isStageSizeFailure(err: unknown): boolean {
  if (err instanceof StageTimeoutError) return false;
  if (err instanceof DOMException && (err.name === "QuotaExceededError" || err.name === "DataCloneError")) return true;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  const blob = text.toLowerCase();
  return (
    blob.includes("413")
    || blob.includes("payload too large")
    || blob.includes("quota")
    || blob.includes("outofmemory")
    || blob.includes("out of memory")
    || blob.includes("allocation")
    || blob.includes("file too large")
    || blob.includes("maximum call stack")
    || blob.includes("array buffer allocation")
  );
}

export function stagingFailureMessage(err: unknown): string {
  if (err instanceof StageTimeoutError) return STAGE_TIMEOUT_ERROR;
  if (isStageSizeFailure(err)) return STAGE_SIZE_ERROR;
  return err instanceof Error && err.message.trim() ? err.message : STAGE_SIZE_ERROR;
}

export async function clearIngestingAsFailed(evidenceId: string, err: unknown) {
  const message = stagingFailureMessage(err);
  await db.evidence.update(evidenceId, { status: "failed", lastError: message });
  return message;
}

export type StagePersistInput = {
  fileName: string;
  fileType: string;
  rawText: string;
  fileSize?: number;
  pageCount?: number;
  flagged?: boolean;
  imageBase64?: string;
  fileBase64?: string;
  thumbnailDataUrl?: string;
  mediaType?: string;
  sha256Hash?: string;
  mimeType?: string;
  originalFileName?: string;
  sourceType?: "pdf" | "image" | "text" | "web_article";
};

type StagedRow = { id: string; status?: string };

async function readAndHashFile(file: File): Promise<StagePersistInput> {
  if (isPdfFile(file)) {
    const fileBase64 = await readFileAsDataUrl(file);
    const sha256Hash = await calculateSHA256(file);
    return {
      fileName: file.name,
      fileType: "pdf",
      rawText: `[PDF document: ${file.name}]`,
      fileSize: file.size,
      fileBase64,
      mediaType: "application/pdf",
      mimeType: file.type || "application/pdf",
      sha256Hash,
      originalFileName: file.name,
      sourceType: "pdf",
    };
  }
  if (isImageFile(file)) {
    const fileBase64 = await readFileAsDataUrl(file);
    const sha256Hash = await calculateSHA256(file);
    let thumb = "";
    try {
      thumb = (await encodeEvidenceImage(file)).thumbnailDataUrl;
    } catch {
      thumb = fileBase64;
    }
    return {
      fileName: file.name,
      fileType: file.name.split(".").pop()?.toLowerCase() || "jpg",
      rawText: `[Image evidence: ${file.name}]`,
      fileSize: file.size,
      imageBase64: fileBase64,
      fileBase64,
      thumbnailDataUrl: thumb,
      mediaType: file.type || "image/jpeg",
      mimeType: file.type || "image/jpeg",
      sha256Hash,
      originalFileName: file.name,
      sourceType: "image",
    };
  }
  if (!isTextFile(file)) {
    throw new Error(`Skipped ${file.name} — use PDF, image (PNG, JPG, WEBP), TXT, MD, CSV, or JSON.`);
  }
  const rawText = await file.text();
  const sha256Hash = await calculateSHA256(file);
  return {
    fileName: file.name,
    fileType: file.name.split(".").pop() || "txt",
    rawText,
    fileSize: file.size,
    mimeType: file.type || "text/plain",
    sha256Hash,
    originalFileName: file.name,
    sourceType: "text",
  };
}

/** Read, hash, and persist one file. Hard-capped at 8s so the card cannot sit on INGESTING. */
export async function stageEvidenceFile(
  file: File,
  persist: (input: StagePersistInput) => Promise<StagedRow | null>,
): Promise<StagedRow | null> {
  const staged = await withStageTimeout((async () => persist(await readAndHashFile(file)))());
  return staged as StagedRow | null;
}

type Tone = "active" | "review" | "cold" | "ok" | "fail";
const TONE_CHIP: Record<Tone, string> = {
  active: "text-blue-700 bg-blue-50 border-blue-200",
  review: "text-amber-700 bg-amber-50 border-amber-200",
  cold: "text-slate-500 bg-slate-100 border-slate-200",
  ok: "text-emerald-700 bg-emerald-50 border-emerald-200",
  fail: "text-red-700 bg-red-50 border-red-200",
};

function Chip({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${TONE_CHIP[tone]} ${className}`}>
      {children}
    </span>
  );
}

function evidenceMeta(q: EvidenceRecord) {
  const bits = [q.fileType.toUpperCase()];
  if (q.pageCount) bits.push(`${q.pageCount} page${q.pageCount === 1 ? "" : "s"}`);
  const size = formatBytes(q.byteSize ?? q.fileSize);
  if (size) bits.push(size);
  return bits.join(" · ");
}

type Props = {
  activeCase: CaseRecord | null;
  caseEvidence: EvidenceRecord[];
  extractError: string | null;
  ingestJob: IngestJob | null;
  nowMs: number;
  busy: boolean;
  dragging: boolean;
  setDragging: Dispatch<SetStateAction<boolean>>;
  pasteText: string;
  setPasteText: Dispatch<SetStateAction<string>>;
  sampleNarrative: string;
  fileRef: RefObject<HTMLInputElement | null>;
  activeEvidenceId: string | null;
  setActiveEvidenceId: (id: string) => void;
  inputCls: string;
  jobElapsed: number;
  onDropFiles: (files: FileList | File[]) => void;
  onPasteSave: (kind?: "official" | "editorial", text?: string) => void;
  onExtract: (id?: string) => void;
  onRetry: (id: string) => void;
  onRetrySummary: (id: string) => void;
  onSkipVerify: () => void;
  onImportUrl: (url: string, onProgress: (stage: "scraping" | "staging") => void) => Promise<void>;
  highlightDropzone?: boolean;
  onHighlightConsumed?: () => void;
};

export default function EvidenceIntake({
  activeCase,
  caseEvidence,
  extractError,
  ingestJob,
  nowMs,
  busy,
  dragging,
  setDragging,
  pasteText,
  setPasteText,
  sampleNarrative,
  fileRef,
  activeEvidenceId,
  setActiveEvidenceId,
  inputCls,
  jobElapsed,
  onDropFiles,
  onPasteSave,
  onExtract,
  onRetry,
  onRetrySummary,
  onSkipVerify,
  onImportUrl,
  highlightDropzone = false,
  onHighlightConsumed,
}: Props) {
  const [articleUrl, setArticleUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [scrapeStage, setScrapeStage] = useState<"idle" | "scraping" | "staging">("idle");
  const [intakeTab, setIntakeTab] = useState<"official" | "press">("official");
  const [editorialText, setEditorialText] = useState("");
  const scrapeBusy = scrapeStage !== "idle";
  useEffect(() => {
    const tick = window.setInterval(() => {
      const now = Date.now();
      for (const row of caseEvidence) {
        if (row.status !== "ingesting") continue;
        if (ingestJob?.evidenceId === row.id) continue;
        const started = row.ingestedAt ? Date.parse(row.ingestedAt) : NaN;
        if (!Number.isFinite(started)) continue;
        const age = now - started;
        if (age < STAGE_TIMEOUT_MS || age > 5 * 60_000) continue;
        void db.evidence.update(row.id, { status: "failed", lastError: STAGE_SIZE_ERROR });
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [caseEvidence, ingestJob?.evidenceId]);

  useEffect(() => {
    const fromHash = typeof window !== "undefined" && window.location.hash === "#file-select";
    if (!highlightDropzone && !fromHash) return;
    setIntakeTab("official");
    const el = document.getElementById("intake-file-dropzone");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = window.setTimeout(() => {
      onHighlightConsumed?.();
      if (fromHash) {
        const { pathname, search } = window.location;
        window.history.replaceState({}, "", `${pathname}${search}`);
      }
    }, 2800);
    return () => window.clearTimeout(t);
  }, [highlightDropzone]);

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
      setUrlError(err instanceof Error ? err.message : "Unable to scrape article directly. Please paste article copy into 'Paste narrative' below.");
    } finally {
      setScrapeStage("idle");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>
            {activeCase ? `${activeCase.id} / ${activeCase.title.toUpperCase()}` : "NO CASE SELECTED"}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">Evidence intake</h1>
        </div>
        {extractError && (
          <div className="flex max-w-[72ch] items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12.5px] leading-relaxed break-words text-amber-700">
            <TriangleAlert className="h-[15px] w-[15px] shrink-0 mt-0.5" />{extractError}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.csv,.json,.log,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) onDropFiles(e.target.files); e.target.value = ""; }}
      />

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-[10px] border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setIntakeTab("official")}
          className={`rounded-[8px] px-2 py-2.5 text-[11px] font-semibold leading-snug sm:text-[12.5px] ${intakeTab === "official" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
        >
          Official Evidence & Court Records
        </button>
        <button
          type="button"
          onClick={() => setIntakeTab("press")}
          className={`rounded-[8px] px-2 py-2.5 text-[11px] font-semibold leading-snug sm:text-[12.5px] ${intakeTab === "press" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
        >
          External Intelligence & Press
        </button>
      </div>

      {intakeTab === "press" && (
        <div className="mb-5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-950">
          {MEDIA_CUSTODY_BANNER}
        </div>
      )}

      {intakeTab === "official" ? (
      <div
        id="intake-file-dropzone"
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onDropFiles(e.dataTransfer.files); }}
        onClick={() => { if (!busy) fileRef.current?.click(); }}
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-[10px] border border-dashed px-10 py-12 text-center transition-colors ${dragging ? "border-blue-600 bg-blue-50/60" : "border-slate-300 bg-white"} ${highlightDropzone ? "intake-dropzone-highlight" : ""}`}
      >
        <div className="mb-[18px] flex h-11 w-11 items-center justify-center rounded-[14px] border border-slate-200 bg-slate-100 text-blue-600">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CloudUpload className="h-5 w-5" />}
        </div>
        <div className="mb-2 text-[23px] font-semibold tracking-tight">
          {ingestJob ? ingestStageLabel(ingestJob) : dragging ? "Release to stage these files" : "Drop PDFs, warrants, or transcripts"}
        </div>
        <p className="mb-[18px] text-[13px] text-slate-500">
          {ingestJob
            ? `${ingestPercent(ingestJob, nowMs)}% · ${ingestElapsedSec(ingestJob, nowMs)}s elapsed — nothing leaves this machine except the extract API call.`
            : <>or <span className="text-blue-600">browse</span> — stored as primary evidence in IndexedDB.</>}
        </p>
        <div className={`flex flex-wrap justify-center gap-2 ${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}>
          {["TXT", "MD", "CSV", "JSON", "PDF", "PNG", "JPG", "WEBP"].map((f) => (
            <span key={f} className="rounded-md border border-slate-200 px-2.5 py-1">{f}</span>
          ))}
        </div>
      </div>
      ) : (
      <div className="rounded-[14px] border border-amber-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Globe className="h-4 w-4 text-amber-700" />
          <h2 className="text-[15px] font-semibold">Import via Web Link / Article</h2>
        </div>
        <p className="mb-3 text-[12.5px] text-slate-500">Fetch a public report, press release, or bulletin. Staged as secondary / media intelligence.</p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            type="url"
            value={articleUrl}
            onChange={(e) => { setArticleUrl(e.target.value); if (urlError) setUrlError(null); }}
            placeholder="Paste a news report, public press release, or bulletin URL (https://...)"
            className={`${inputCls} h-10 flex-1 px-3 text-[13px]`}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void fetchArticle(); } }}
            disabled={scrapeBusy || busy}
          />
          <button
            type="button"
            disabled={scrapeBusy || busy || !articleUrl.trim()}
            onClick={() => void fetchArticle()}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {scrapeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            Fetch & Stage Article
          </button>
        </div>
        {scrapeBusy && (
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-blue-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {scrapeStage === "staging" ? "Staging into Vault..." : "Scraping readable text..."}
          </div>
        )}
        {urlError && (
          <div className="mt-3 flex items-start gap-2 text-[12.5px] text-amber-800">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{urlError}
          </div>
        )}
      </div>
      )}

      {intakeTab === "official" ? (
      <div className="mt-6 rounded-[14px] border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Paste official narrative</h2>
          <button type="button" onClick={() => setPasteText(sampleNarrative)}
            className={`${mono} text-[10.5px] tracking-[0.08em] text-blue-600 hover:underline`}>LOAD SAMPLE</button>
        </div>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={7}
          placeholder="Paste a police narrative, interview notes, or field log…"
          className={`${inputCls} resize-y py-3 text-[13.5px] leading-relaxed`} />
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={!pasteText.trim()}
            onClick={() => onPasteSave("official")}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            Save to vault
          </button>
        </div>
      </div>
      ) : (
      <div className="mt-6 rounded-[14px] border border-amber-200 bg-white p-5">
        <h2 className="mb-3 text-[15px] font-semibold">Paste editorial narrative</h2>
        <textarea value={editorialText} onChange={(e) => setEditorialText(e.target.value)} rows={7}
          placeholder="Paste news copy, press notes, or open-source reporting…"
          className={`${inputCls} resize-y py-3 text-[13.5px] leading-relaxed`} />
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={!editorialText.trim()}
            onClick={() => {
              const text = editorialText;
              setEditorialText("");
              onPasteSave("editorial", text);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-amber-400 bg-amber-50 px-4 text-[13px] font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-40">
            Index as secondary
          </button>
        </div>
      </div>
      )}

      <div className="mb-1 mt-10 flex items-center justify-between border-b border-slate-200 pb-3.5">
        <h2 className={`${mono} text-[11px] font-medium tracking-[0.14em] text-slate-500`}>STAGING QUEUE</h2>
        <span className={`${mono} text-[11px] text-slate-500`}>{caseEvidence.length} FILES</span>
      </div>

      <div>
        {caseEvidence.map((q) => {
          const job = ingestJob?.evidenceId === q.id ? ingestJob : null;
          const pct = job ? ingestPercent(job, nowMs) : 0;
          const elapsed = job ? ingestElapsedSec(job, nowMs) : 0;
          const failed = q.status === "failed";
          const isWeb = inferSourceType(q) === "web_article";
          const secondary = isSecondaryEvidence(q);
          const chipTone: Tone = failed ? "fail" : q.textClarity === "low" || q.status === "flagged" ? "review" : q.status === "indexed" ? "ok" : "active";
          return (
            <div key={q.id} className={`border-b border-slate-100 px-0.5 py-[15px] ${activeEvidenceId === q.id ? "bg-blue-50/50" : ""}`}>
              <div className="grid grid-cols-[34px_minmax(0,1fr)_minmax(96px,38%)_20px] items-start gap-4">
                <div className="flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-[10px] border border-slate-200 bg-white text-slate-500">
                  {evidenceImageSrc(q) ? (
                    <EvidenceThumb src={evidenceImageSrc(q)} alt={q.fileName} className="h-[34px] w-[34px] rounded-[9px] border-0" />
                  ) : isWeb ? (
                    <Globe className="h-[15px] w-[15px] text-blue-600" />
                  ) : (
                    <FileText className="h-[15px] w-[15px]" />
                  )}
                </div>
                <button type="button" className="min-w-0 text-left" onClick={() => setActiveEvidenceId(q.id)}>
                  <div className={`mb-1 flex min-w-0 items-center gap-2 ${mono} text-[13px]`}>
                    <span className="truncate">{q.fileName}</span>
                    {secondary && (
                      <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9.5px] tracking-[0.06em] text-amber-900">
                        {sourceClassLabel(q.sourceClass) || "SECONDARY"}
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-slate-500">
                    {job
                      ? `${ingestStageLabel(job)} · ${elapsed}s elapsed`
                      : failed && q.lastError
                        ? q.lastError
                        : q.textClarity === "low"
                          ? SCAN_NOTE
                          : isWeb
                            ? `${q.wordCount ? `${q.wordCount.toLocaleString()} words` : "WEB ARTICLE"}${q.publishedDate ? ` · ${q.publishedDate}` : ""}`
                            : `${evidenceMeta(q)}${q.rawText ? ` · ${q.rawText.slice(0, 72)}${q.rawText.length > 72 ? "…" : ""}` : q.status === "flagged" ? " · No selectable text layer" : " · Empty"}`}
                  </div>
                </button>
                <div className="pt-1 text-right">
                  {job ? (
                    <span className={`${mono} text-[11px] tabular-nums text-blue-700`}>{pct}%</span>
                  ) : (
                    <span title={failed ? (q.lastError || "Extraction failed") : undefined}>
                      <Chip tone={chipTone} className={`max-w-full ${failed ? "cursor-help whitespace-normal text-left tracking-normal" : "shrink-0 whitespace-nowrap"}`}>
                        {failed ? (q.lastError || "FAILED") : q.textClarity === "low" ? "SCANNED" : q.status.toUpperCase()}
                      </Chip>
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => void deleteEvidence(q.id)} className="mt-1.5 text-slate-400 hover:text-slate-700">
                  <X className="h-[15px] w-[15px]" />
                </button>
              </div>
              {q.sourceUrl && (
                <div className="ml-[50px] mt-1.5">
                  <a
                    href={q.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex max-w-full items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-mono text-[10.5px] text-blue-800 hover:border-blue-400"
                  >
                    <span className="truncate">{q.sourceUrl}</span>
                  </a>
                </div>
              )}
              {job && (
                <div className="mt-3 ml-[50px] mr-7">
                  <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out ${job.stage === "claude" && pct < 90 ? "opacity-90" : ""}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
              {((failed && !isWeb) || isWeb) && !job && (
                <div className="mt-2.5 ml-[50px] mr-7 flex flex-wrap gap-2">
                  {isWeb ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onExtract(q.id)}
                      className="inline-flex h-7 items-center rounded-lg border border-blue-300 bg-blue-50 px-2.5 text-[11.5px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                    >
                      Extract with AI
                    </button>
                  ) : (
                    <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRetry(q.id)}
                    className="inline-flex h-7 items-center rounded-lg border border-slate-300 px-2.5 text-[11.5px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900 disabled:opacity-40"
                  >
                    Retry (First 3 Pages)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRetrySummary(q.id)}
                    className="inline-flex h-7 items-center rounded-lg border border-blue-300 bg-blue-50 px-2.5 text-[11.5px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                  >
                    Extract Summary
                  </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {caseEvidence.length === 0 && (
          <div className="py-8 text-center text-[13px] text-slate-500">No files in this case yet.</div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2.5">
        <button type="button" onClick={onSkipVerify}
          className="h-[38px] rounded-[10px] border border-slate-300 px-4 text-[13px] text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">Skip to verify</button>
        <button type="button" onClick={() => onExtract()} disabled={busy || caseEvidence.length === 0}
          className="inline-flex h-[38px] min-w-[188px] items-center justify-center gap-2 rounded-[10px] bg-blue-600 px-[18px] text-[13px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40">
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {ingestJob?.stage === "render" || ingestJob?.stage === "pdf"
                ? ingestStageLabel(ingestJob)
                : ingestJob?.stage === "claude"
                  ? "Analyzing evidence..."
                  : ingestJob?.stage === "events"
                    ? "Extracting events…"
                    : ingestJob?.stage === "done"
                      ? "Done"
                      : "Extracting..."}
              <span className={`${mono} font-medium opacity-80`}>({jobElapsed}s)</span>
            </>
          ) : (
            <>{caseEvidence.some((e) => e.status === "failed" && e.id === (activeEvidenceId ?? caseEvidence[0]?.id)) ? "Retry extract" : "Extract with AI"}<ArrowRight className="h-3.5 w-3.5" /></>
          )}
        </button>
      </div>
    </div>
  );
}
