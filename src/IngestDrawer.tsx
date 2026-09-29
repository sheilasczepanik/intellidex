import { useState } from "react";
import { CloudUpload, Globe, Loader2, Scale, TriangleAlert, X } from "lucide-react";
import { EVIDENCE_ACCEPT } from "./lib/pdfText";
import { parseArticleUrl } from "./lib/scrapeClient";
import { MEDIA_CUSTODY_BANNER } from "./lib/sourceTier";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

export default function IngestDrawer({
  open,
  busy,
  error,
  onClose,
  onDropFiles,
  onPaste,
  onImportUrl,
}: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onDropFiles: (files: FileList | File[]) => void | Promise<void>;
  onPaste: (text: string, kind?: "official" | "editorial") => void | Promise<void>;
  onImportUrl: (url: string, onProgress: (stage: "scraping" | "staging") => void) => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [paste, setPaste] = useState("");
  const [editorial, setEditorial] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [scrapeStage, setScrapeStage] = useState<"idle" | "scraping" | "staging">("idle");
  const [tab, setTab] = useState<"official" | "press">("official");
  const scrapeBusy = scrapeStage !== "idle";

  if (!open) return null;

  const takeFiles = async (list: FileList | File[] | null) => {
    if (!list || (Array.isArray(list) ? list.length === 0 : list.length === 0)) return;
    await onDropFiles([...list]);
    onClose();
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
      onClose();
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : "Unable to scrape that link. Paste the article copy below.");
    } finally {
      setScrapeStage("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[440px] flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <div>
            <div className={`${mono} text-[10px] tracking-[0.14em] text-slate-500`}>INGEST EVIDENCE</div>
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
                className={`flex cursor-pointer flex-col items-center justify-center rounded-[12px] border-2 border-dashed px-4 py-10 text-center transition-colors ${
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
                <p className={`mt-1 ${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}>PRIMARY EVIDENCE · PDF · TXT · IMAGES</p>
              </label>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Scale className="h-3.5 w-3.5 text-slate-600" />
                  <h3 className="text-[13.5px] font-semibold">Official narrative</h3>
                </div>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={7}
                  placeholder="Paste police narrative, interview notes, or field logs…"
                  className={`${inputCls} resize-y py-2.5 text-[13px] leading-relaxed`}
                />
                <button
                  type="button"
                  disabled={!paste.trim() || busy}
                  onClick={() => {
                    const text = paste;
                    setPaste("");
                    void Promise.resolve(onPaste(text, "official")).then(() => onClose());
                  }}
                  className="mt-2 inline-flex h-9 items-center rounded-[10px] bg-blue-600 px-3.5 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  Register notes
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
                <p className="mb-2 text-[12px] text-slate-500">Indexed as secondary / media intelligence. Does not overwrite verified records.</p>
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
                  rows={7}
                  placeholder="Paste news copy, press notes, or open-source reporting…"
                  className={`${inputCls} resize-y py-2.5 text-[13px] leading-relaxed`}
                />
                <button
                  type="button"
                  disabled={!editorial.trim() || busy}
                  onClick={() => {
                    const text = editorial;
                    setEditorial("");
                    void Promise.resolve(onPaste(text, "editorial")).then(() => onClose());
                  }}
                  className="mt-2 inline-flex h-9 items-center rounded-[10px] border border-amber-400 bg-amber-50 px-3.5 text-[12.5px] font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-40"
                >
                  Index as secondary
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
