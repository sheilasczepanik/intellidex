import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ExternalLink, FileText, Image as ImageIcon, Link2, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  addCaseMedia,
  db,
  deleteCaseMedia,
  updateCaseMedia,
  CASE_MEDIA_CATEGORIES,
  type CaseMediaCategory,
  type CaseMediaRecord,
  type CaseRecord,
} from "./db";
import { calculateSHA256, calculateSHA256FromDataUrl, calculateSHA256FromText } from "./lib/cryptoUtils";
import { applyDupDecision, findDuplicateMedia, mediaToSide, type DupDecision, type DupMatch } from "./lib/duplicates";
import { encodeCaseMedia, isImageFile } from "./lib/imageEvidence";
import { renderPdfPagesToJpeg } from "./lib/pdfHelpers";
import { isPdfFile, readFileAsDataUrl } from "./lib/pdfText";
import { parseArticleUrl, parseMetadataFromUrl } from "./lib/scrapeClient";

export const MEDIA_CATEGORY_LABEL: Record<CaseMediaCategory, string> = {
  subject_flyer: "Subject flyer",
  surveillance: "Surveillance",
  ping_data: "Ping data",
  witness_photo: "Witness photo",
  search_log: "Search log",
  uncategorized: "Uncategorized",
};

const CATEGORY_FILTERS: { id: "all" | CaseMediaCategory; label: string }[] = [
  { id: "all", label: "All" },
  ...CASE_MEDIA_CATEGORIES.map((id) => ({ id, label: MEDIA_CATEGORY_LABEL[id] })),
];

type SortKey = "newest" | "oldest" | "category" | "type";

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.replace(/^data:[^;]+;base64,/i, "");
}

export default function MediaGallery({
  activeCase,
  onArbitrate,
  focusArchive,
}: {
  activeCase: CaseRecord;
  onArbitrate?: (match: DupMatch) => Promise<DupDecision>;
  focusArchive?: boolean;
}) {
  const rows = useLiveQuery(
    () => db.caseMedia.where("caseId").equals(activeCase.id).toArray(),
    [activeCase.id],
  ) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"all" | CaseMediaCategory>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "pdf" | "url">("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<CaseMediaRecord | null>(null);
  const [zoom, setZoom] = useState(1);
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<CaseMediaCategory>("uncategorized");
  const [summary, setSummary] = useState("");

  const shown = useMemo(() => {
    const filtered = rows.filter((r) => (filter === "all" || r.category === filter) && (typeFilter === "all" || r.type === typeFilter));
    const copy = [...filtered];
    if (sort === "oldest") copy.sort((a, b) => a.dateAdded - b.dateAdded);
    else if (sort === "category") copy.sort((a, b) => a.category.localeCompare(b.category) || b.dateAdded - a.dateAdded);
    else if (sort === "type") copy.sort((a, b) => a.type.localeCompare(b.type) || b.dateAdded - a.dateAdded);
    else copy.sort((a, b) => b.dateAdded - a.dateAdded);
    return copy;
  }, [rows, filter, typeFilter, sort]);

  const persistMedia = async (draft: Parameters<typeof addCaseMedia>[0]) => {
    const hit = await findDuplicateMedia(activeCase.id, { sha256Hash: draft.sha256Hash, sourceUrl: draft.sourceUrl });
    if (hit && onArbitrate) {
      const decision = await onArbitrate({
        kind: "media",
        existingId: hit.id,
        existing: mediaToSide(hit),
        incoming: mediaToSide({
          ...hit,
          id: "incoming",
          title: draft.title,
          category: draft.category,
          type: draft.type ?? "image",
          summary: draft.summary,
          description: draft.description,
          sourceUrl: draft.sourceUrl,
          sha256Hash: draft.sha256Hash,
          dateAdded: Date.now(),
          dataUrl: draft.dataUrl || "",
          tags: draft.tags ?? [],
          caseId: activeCase.id,
        }, true),
      });
      const applied = await applyDupDecision(
        { kind: "media", existingId: hit.id, existing: mediaToSide(hit), incoming: mediaToSide(hit, true) },
        decision,
        { summary: draft.summary, description: draft.description, id: "incoming" },
      );
      if (applied.action === "abort" || applied.action === "merge") return applied.action;
    } else if (hit) {
      setError("That file or URL is already in the vault.");
      return "abort";
    }
    await addCaseMedia(draft);
    return "added";
  };

  const ingestFiles = async (files: FileList | File[]) => {
    const usable = Array.from(files).filter((f) => isImageFile(f) || isPdfFile(f));
    if (!usable.length) {
      setError("Drop JPG, PNG, WEBP, or PDF files.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of usable) {
        if (isPdfFile(file)) {
          const dataUrl = await readFileAsDataUrl(file);
          const sha256Hash = await calculateSHA256(file);
          let thumbnailUrl = "";
          try {
            const rendered = await renderPdfPagesToJpeg(dataUrlToBase64(dataUrl), { maxPages: 1, scale: 1.1, quality: 0.72 });
            thumbnailUrl = rendered.pages[0]?.imageBase64 || "";
          } catch {
            thumbnailUrl = "";
          }
          await persistMedia({
            caseId: activeCase.id,
            dataUrl,
            thumbnailUrl,
            title: file.name.replace(/\.[^.]+$/, ""),
            category,
            originalFileName: file.name,
            type: "pdf",
            sha256Hash,
            summary: summary.trim() || undefined,
            tags: summary.trim() ? ["archive"] : ["archive"],
          });
        } else {
          const dataUrl = await encodeCaseMedia(file);
          const sha256Hash = await calculateSHA256FromDataUrl(dataUrl);
          await persistMedia({
            caseId: activeCase.id,
            dataUrl,
            thumbnailUrl: dataUrl,
            title: file.name.replace(/\.[^.]+$/, ""),
            category,
            originalFileName: file.name,
            type: "image",
            sha256Hash,
            summary: summary.trim() || undefined,
            tags: ["archive"],
          });
        }
      }
      setSummary("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not store that file.");
    } finally {
      setBusy(false);
    }
  };

  const ingestUrl = async () => {
    const parsed = parseArticleUrl(url);
    if (!parsed) {
      setError("Enter a valid http(s) news or social URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = await parseMetadataFromUrl(parsed);
      await persistMedia({
        caseId: activeCase.id,
        dataUrl: meta.image || "",
        thumbnailUrl: meta.image || meta.favicon,
        title: meta.title,
        category,
        type: "url",
        sourceUrl: meta.url,
        description: meta.description,
        author: meta.author,
        faviconUrl: meta.favicon,
        summary: summary.trim() || meta.description,
        sha256Hash: await calculateSHA256FromText(meta.url),
        tags: ["url", "tip"],
      });
      setUrl("");
      setSummary("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse that URL.");
    } finally {
      setBusy(false);
    }
  };

  const previewSrc = (row: CaseMediaRecord) => row.thumbnailUrl || (row.type === "image" ? row.dataUrl : row.faviconUrl || row.dataUrl);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Case Media Vault</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
            Images, PDFs, and external tips stay on this machine. Investigative records still go through Verify; this vault is for secondary intelligence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 text-[12.5px] font-semibold text-white hover:bg-blue-700"
        >
          <Upload className="h-3.5 w-3.5" />Upload files
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className={`mb-5 rounded-[14px] border p-4 ${focusArchive ? "border-amber-400 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
        <div className="mb-3 font-mono text-[10px] tracking-[0.12em] text-slate-500">ARCHIVE MEDIA & TIPS</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-[11px] text-slate-500">
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as CaseMediaCategory)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-[13px] text-slate-800">
              {CASE_MEDIA_CATEGORIES.map((id) => (
                <option key={id} value={id}>{MEDIA_CATEGORY_LABEL[id]}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-slate-500">
            Narrative summary
            <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Optional investigator note" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-[13px] text-slate-800" />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a news or social URL — parsed, not sent to Verify"
              className="h-10 w-full rounded-[10px] border border-slate-300 bg-white pl-8 pr-3 text-[13px] outline-none focus:border-blue-600"
            />
          </div>
          <button type="button" onClick={() => void ingestUrl()} disabled={busy} className="h-10 shrink-0 rounded-[10px] border border-slate-300 px-3 text-[13px] font-medium text-slate-700 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40">
            Save URL to vault
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATEGORY_FILTERS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setFilter(opt.id)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium ${filter === opt.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
          >
            {opt.label}
          </button>
        ))}
        <div className="flex gap-1">
          {(["all", "image", "pdf", "url"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${typeFilter === key ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-500"}`}
            >
              {key === "all" ? "Any type" : key.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="ml-auto text-[12px] text-slate-500">
          Sort{" "}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-800"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="type">File type</option>
            <option value="category">Category</option>
          </select>
        </label>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingestFiles(e.dataTransfer.files);
        }}
        className={`mb-6 rounded-[14px] border-2 border-dashed px-5 py-8 text-center text-[13px] ${dragging ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-slate-50 text-slate-500"}`}
      >
        <ImageIcon className="mx-auto mb-2 h-5 w-5" />
        {busy ? "Saving to local vault…" : "Drag and drop JPG, PNG, WEBP, or PDF files"}
      </div>

      {error && (
        <div className="mb-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">{error}</div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-[13px] text-slate-500">
          Vault is empty for this filter. Upload a file or paste a URL.
        </div>
      ) : (
        <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))]">
          {shown.map((row) => (
            <li key={row.id} className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => { if (row.type !== "url") { setLightbox(row); setZoom(1); } }}
                className="relative block w-full bg-slate-100"
              >
                {previewSrc(row) ? (
                  <img src={previewSrc(row)} alt={row.title} className="h-40 w-full object-cover" />
                ) : (
                  <div className="flex h-40 items-center justify-center text-slate-400"><FileText className="h-8 w-8" /></div>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-slate-950/75 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-white">
                  {row.type.toUpperCase()}
                </span>
              </button>
              <div className="space-y-2 p-3">
                <input
                  value={row.title}
                  onChange={(e) => void updateCaseMedia(row.id, { title: e.target.value })}
                  className="w-full rounded-md border border-transparent px-1 py-0.5 text-[13px] font-medium text-slate-900 outline-none hover:border-slate-200 focus:border-blue-400"
                  aria-label="Title"
                />
                <select
                  value={row.category}
                  onChange={(e) => void updateCaseMedia(row.id, { category: e.target.value as CaseMediaCategory })}
                  className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11.5px] text-slate-600"
                  aria-label="Category"
                >
                  {CASE_MEDIA_CATEGORIES.map((id) => (
                    <option key={id} value={id}>{MEDIA_CATEGORY_LABEL[id]}</option>
                  ))}
                </select>
                {row.author ? <div className="text-[11px] text-slate-500">{row.author}</div> : null}
                <textarea
                  defaultValue={row.summary || ""}
                  onBlur={(e) => void updateCaseMedia(row.id, { summary: e.target.value })}
                  placeholder="Narrative summary"
                  rows={2}
                  className="w-full rounded-md border border-slate-100 px-1 py-0.5 text-[11px] text-slate-600 outline-none focus:border-blue-300"
                />
                {row.sourceUrl ? (
                  <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-700 hover:underline">
                    <ExternalLink className="h-3 w-3" />Open original URL
                  </a>
                ) : null}
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{new Date(row.dateAdded).toLocaleDateString()}</span>
                  <button
                    type="button"
                    onClick={() => void deleteCaseMedia(row.id)}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                    aria-label="Delete media"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true">
          <div className="relative max-h-full max-w-5xl overflow-auto rounded-[16px] bg-slate-900 p-3">
            <div className="mb-2 flex items-center justify-end gap-1">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"><ZoomOut className="h-4 w-4" /></button>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"><ZoomIn className="h-4 w-4" /></button>
              <button type="button" aria-label="Close" onClick={() => setLightbox(null)} className="rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"><X className="h-4 w-4" /></button>
            </div>
            {lightbox.type === "pdf" && lightbox.dataUrl ? (
              <iframe src={lightbox.dataUrl} title={lightbox.title} className="h-[80vh] w-[min(900px,90vw)] rounded-md bg-white" />
            ) : (
              <img
                src={lightbox.dataUrl || lightbox.thumbnailUrl}
                alt={lightbox.title}
                style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
                className="max-h-[80vh] max-w-full rounded-md object-contain"
              />
            )}
            <p className="mt-2 text-center text-[13px] text-white/80">{lightbox.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}
