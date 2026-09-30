import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Image as ImageIcon, Trash2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  addCaseMedia,
  db,
  deleteCaseMedia,
  updateCaseMedia,
  type CaseMediaCategory,
  type CaseMediaRecord,
  type CaseRecord,
} from "./db";
import { encodeCaseMedia, isImageFile } from "./lib/imageEvidence";

const CATEGORY_FILTERS: { id: "all" | CaseMediaCategory; label: string }[] = [
  { id: "all", label: "All Media" },
  { id: "subject", label: "Subject Photos & Flyers" },
  { id: "surveillance", label: "Surveillance / Dashcam Stills" },
  { id: "evidence", label: "Evidence & Belongings" },
  { id: "search_maps", label: "Search Maps & Drone Stills" },
];

const CATEGORY_LABEL: Record<CaseMediaCategory, string> = {
  subject: "Subject Photos & Flyers",
  surveillance: "Surveillance / Dashcam Stills",
  evidence: "Evidence & Belongings",
  search_maps: "Search Maps & Drone Stills",
};

type SortKey = "newest" | "oldest" | "category";

export default function MediaGallery({ activeCase }: { activeCase: CaseRecord }) {
  const rows = useLiveQuery(
    () => db.caseMedia.where("caseId").equals(activeCase.id).toArray(),
    [activeCase.id],
  ) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"all" | CaseMediaCategory>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<CaseMediaRecord | null>(null);
  const [zoom, setZoom] = useState(1);

  const shown = useMemo(() => {
    const filtered = filter === "all" ? rows : rows.filter((r) => r.category === filter);
    const copy = [...filtered];
    if (sort === "oldest") copy.sort((a, b) => a.dateAdded - b.dateAdded);
    else if (sort === "category") {
      copy.sort((a, b) => a.category.localeCompare(b.category) || b.dateAdded - a.dateAdded);
    } else copy.sort((a, b) => b.dateAdded - a.dateAdded);
    return copy;
  }, [rows, filter, sort]);

  const ingestFiles = async (files: FileList | File[]) => {
    const images = Array.from(files).filter(isImageFile);
    if (!images.length) {
      setError("Drop JPG, PNG, or WEBP images.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of images) {
        const dataUrl = await encodeCaseMedia(file);
        await addCaseMedia({
          caseId: activeCase.id,
          dataUrl,
          title: file.name.replace(/\.[^.]+$/, ""),
          category: filter === "all" ? "subject" : filter,
          originalFileName: file.name,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not store that image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-slate-950">Media & Images</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
            Flyers, stills, belongings, and search images stay on this machine in IndexedDB. Filter by category and open a still for a full-resolution preview.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 text-[12.5px] font-semibold text-white hover:bg-blue-700"
        >
          <Upload className="h-3.5 w-3.5" />Upload images
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = "";
          }}
        />
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
        <label className="ml-auto text-[12px] text-slate-500">
          Sort{" "}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12.5px] text-slate-800"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
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
        {busy ? "Saving to local vault…" : "Drag and drop JPG, PNG, or WEBP files here"}
      </div>

      {error && (
        <div className="mb-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">{error}</div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-[13px] text-slate-500">
          No images in this filter yet. Upload a flyer or still to start the gallery.
        </div>
      ) : (
        <ul className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))]">
          {shown.map((row) => (
            <li key={row.id} className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => { setLightbox(row); setZoom(1); }}
                className="block w-full bg-slate-100"
              >
                <img src={row.dataUrl} alt={row.title} className="h-40 w-full object-cover" />
              </button>
              <div className="space-y-2 p-3">
                <input
                  value={row.title}
                  onChange={(e) => void updateCaseMedia(row.id, { title: e.target.value })}
                  className="w-full rounded-md border border-transparent px-1 py-0.5 text-[13px] font-medium text-slate-900 outline-none hover:border-slate-200 focus:border-blue-400"
                  aria-label="Caption"
                />
                <select
                  value={row.category}
                  onChange={(e) => void updateCaseMedia(row.id, { category: e.target.value as CaseMediaCategory })}
                  className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11.5px] text-slate-600"
                  aria-label="Category"
                >
                  {(Object.keys(CATEGORY_LABEL) as CaseMediaCategory[]).map((id) => (
                    <option key={id} value={id}>{CATEGORY_LABEL[id]}</option>
                  ))}
                </select>
                <input
                  defaultValue={row.tags.join(", ")}
                  onBlur={(e) => {
                    const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
                    void updateCaseMedia(row.id, { tags });
                  }}
                  placeholder="Tags (comma separated)"
                  className="w-full rounded-md border border-slate-100 px-1 py-0.5 text-[11px] text-slate-500 outline-none focus:border-blue-300"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{new Date(row.dateAdded).toLocaleDateString()}</span>
                  <button
                    type="button"
                    onClick={() => void deleteCaseMedia(row.id)}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                    aria-label="Delete image"
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
            <img
              src={lightbox.dataUrl}
              alt={lightbox.title}
              style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
              className="max-h-[80vh] max-w-full rounded-md object-contain"
            />
            <p className="mt-2 text-center text-[13px] text-white/80">{lightbox.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}
