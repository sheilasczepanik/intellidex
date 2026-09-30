import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Globe, Loader2, Minus, Plus, Radio, X } from "lucide-react";
import { getDocument, Util, type PDFDocumentProxy } from "pdfjs-dist";
import { pdfBlobFromBytes, pdfBytesFromBase64 } from "./lib/pdfjsSetup";
import { db, type EvidenceRecord } from "./db";
import { collectQuoteSpans, locateSnippet, splitTextBySpans } from "./lib/quoteAnchors";
import { evidenceImageSrc } from "./lib/imageEvidence";
import {
  citationPillLabel,
  inferSourceType,
  type SourceBoundingBox,
  type SourceCitation,
} from "./types";

const MARK =
  "cursor-pointer rounded px-0.5 bg-amber-300/40 border-b-2 border-amber-500 box-decoration-clone";
const MARK_ACTIVE =
  "cursor-pointer rounded px-0.5 bg-amber-400/55 border-b-2 border-amber-600 ring-2 ring-amber-500/50 box-decoration-clone";

export function CitationPill({
  citation,
  onClick,
}: {
  citation: SourceCitation;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={citation.exactQuote}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-left text-[11.5px] font-medium text-amber-900 hover:border-amber-400 hover:bg-amber-100"
    >
      {citation.sourceType === "external_intel" ? (
        <Radio className="h-3 w-3 shrink-0" />
      ) : citation.sourceType === "web_article" || citation.sourceUrl ? (
        <Globe className="h-3 w-3 shrink-0" />
      ) : (
        <FileText className="h-3 w-3 shrink-0" />
      )}
      <span className="min-w-0 truncate">{citationPillLabel(citation)}</span>
    </button>
  );
}

type OverlayBox = SourceBoundingBox & { id: string };

type ViewerAnchor = {
  id: string;
  citation: SourceCitation;
};

type Props = {
  evidence: EvidenceRecord | null;
  citation: SourceCitation | null;
  anchors?: ViewerAnchor[];
  activeId?: string | null;
  onClose?: () => void;
  onSelectAnchor?: (id: string) => void;
  showClose?: boolean;
};

export default function SourceDocumentViewer({
  evidence,
  citation,
  anchors = [],
  activeId,
  onClose,
  onSelectAnchor,
  showClose = true,
}: Props) {
  const kind = evidence ? inferSourceType(evidence) : citation?.sourceType ?? "text";
  const title = evidence?.fileName || citation?.sourceName || "Source";
  const [page, setPage] = useState(citation?.pageNumber || 1);
  const [pageCount, setPageCount] = useState(evidence?.pageCount || 1);
  const [zoom, setZoom] = useState(1);
  const [fitToken, setFitToken] = useState(0);
  const [matched, setMatched] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfEpoch, setPdfEpoch] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [pdfBoxes, setPdfBoxes] = useState<OverlayBox[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  const focus = citation;
  const quote = (focus?.exactQuote || "").trim();
  const anchorSig = anchors.map((a) => `${a.id}:${a.citation.exactQuote}:${a.citation.pageNumber ?? ""}`).join("|");

  useEffect(() => {
    if (citation?.pageNumber) setPage(citation.pageNumber);
  }, [citation?.sourceId, citation?.pageNumber, citation?.exactQuote]);

  useEffect(() => {
    let cancelled = false;
    const evidenceId = evidence?.id;
    if (kind !== "pdf" || !evidenceId) {
      void pdfRef.current?.cleanup();
      pdfRef.current = null;
      return;
    }
    setBusy(true);
    setPdfError(null);
    void (async () => {
      try {
        const sourceRecord = await db.evidence.get(evidenceId);
        const raw = sourceRecord?.fileBase64 || evidence?.fileBase64 || "";
        if (!sourceRecord || !raw) {
          console.error("Missing raw file data in IndexedDB");
          if (!cancelled) setPdfError("Missing raw PDF data in the local vault.");
          return;
        }
        const bytes = pdfBytesFromBase64(raw);
        const loadingTask = getDocument({ data: bytes });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.cleanup();
          return;
        }
        void pdfRef.current?.cleanup();
        pdfRef.current = doc;
        setPageCount(doc.numPages);
        setPage((p) => Math.min(Math.max(1, p), doc.numPages));
        setPdfEpoch((n) => n + 1);
      } catch (err) {
        console.error("[PDF] getDocument failed", err);
        if (!cancelled) setPdfError(err instanceof Error ? err.message : "Could not open PDF.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evidence?.id, evidence?.fileBase64, kind]);

  useEffect(() => {
    const raw = evidence?.fileBase64;
    if (kind !== "pdf" || !raw) {
      setBlobUrl(null);
      return;
    }
    try {
      const blob = pdfBlobFromBytes(pdfBytesFromBase64(raw));
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[PDF] Could not build object URL", err);
      setBlobUrl(null);
    }
  }, [evidence?.id, evidence?.fileBase64, kind]);

  useEffect(() => () => {
    void pdfRef.current?.cleanup();
    pdfRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pdf = pdfRef.current;
    if (kind !== "pdf" || !canvas || !pdf) return;
    let cancelled = false;
    const run = async () => {
      setBusy(true);
      try {
        const pg = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
        const base = pg.getViewport({ scale: 1 });
        const host = stageRef.current;
        const fitScale = host ? Math.max(0.4, (host.clientWidth - 32) / base.width) : 1;
        const scale = zoom * (fitToken >= 0 ? fitScale : fitScale);
        const viewport = pg.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setCanvasSize({ w: viewport.width, h: viewport.height });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const renderContext = {
          canvasContext: ctx,
          viewport,
          canvas,
        };
        await pg.render(renderContext).promise;
        if (cancelled) return;
        const content = await pg.getTextContent();
        const items = content.items.flatMap((it) => {
          if (typeof it !== "object" || !it || !("str" in it) || !("transform" in it)) return [];
          const row = it as { str: string; transform: number[]; width: number; height: number };
          return row.str ? [row] : [];
        });
        let hay = "";
        const spans: { start: number; end: number; item: (typeof items)[number] }[] = [];
        for (const item of items) {
          if (!item.str) continue;
          const start = hay.length;
          hay += item.str;
          spans.push({ start, end: hay.length, item });
          hay += " ";
        }
        const boxes: OverlayBox[] = [];
        const toBox = (item: (typeof items)[number], id: string): OverlayBox => {
          const tx = Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(tx[2], tx[3]);
          const width = item.width * Math.hypot(tx[0], tx[1]);
          const left = tx[4];
          const top = tx[5] - height;
          return {
            id,
            x: (left / viewport.width) * 100,
            y: (top / viewport.height) * 100,
            width: (width / viewport.width) * 100,
            height: (height / viewport.height) * 100,
          };
        };
        const quoteAnchors = [
          ...(focus?.exactQuote ? [{ id: activeId || "focus", quote: focus.exactQuote }] : []),
          ...anchors.filter((a) => a.id !== activeId).map((a) => ({ id: a.id, quote: a.citation.exactQuote })),
        ];
        let foundFocus = !quote;
        for (const a of quoteAnchors) {
          const loc = locateSnippet(hay, a.quote);
          if (!loc) continue;
          if (a.id === (activeId || "focus")) foundFocus = true;
          for (const span of spans) {
            if (span.end > loc.start && span.start < loc.end) boxes.push(toBox(span.item, a.id));
          }
        }
        if (focus?.boundingBox && boxes.filter((b) => b.id === (activeId || "focus")).length === 0) {
          boxes.push({ id: activeId || "focus", ...focus.boundingBox });
          foundFocus = true;
        }
        setPdfBoxes(boxes);
        setMatched(foundFocus);
      } catch (err) {
        if (!cancelled) setPdfError(err instanceof Error ? err.message : "Could not render page.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [kind, page, zoom, fitToken, pdfEpoch, evidence?.id, focus?.exactQuote, focus?.boundingBox, activeId, anchorSig]);

  const textSegments = useMemo(() => {
    if (!evidence?.rawText) return [];
    const drafts = [
      ...(quote ? [{ id: activeId || "focus", snippet: quote }] : []),
      ...anchors.map((a) => ({ id: a.id, snippet: a.citation.exactQuote })),
    ];
    return splitTextBySpans(evidence.rawText, collectQuoteSpans(evidence.rawText, drafts));
  }, [evidence?.rawText, quote, anchorSig, activeId]);

  useEffect(() => {
    if ((kind === "text" || kind === "external_intel" || kind === "web_article") && quote && evidence?.rawText) {
      setMatched(Boolean(locateSnippet(evidence.rawText, quote)));
    }
  }, [kind, quote, evidence?.rawText, page]);

  useEffect(() => {
    const el = document.getElementById(`source-hit-${activeId || "focus"}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeId, quote, page, textSegments, pdfBoxes]);

  const imageSrc = evidence ? (evidence.imageBase64 || evidence.fileBase64 || evidenceImageSrc(evidence)) : "";
  const imageBoxes: OverlayBox[] = [];
  if (kind === "image") {
    if (focus?.boundingBox) imageBoxes.push({ id: activeId || "focus", ...focus.boundingBox });
    for (const a of anchors) {
      if (a.citation.boundingBox) imageBoxes.push({ id: a.id, ...a.citation.boundingBox });
    }
  }

  const approxBanner = !matched && quote ? (
    <div className="mx-3 mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      Approximate citation location on page {page}. Matched text: “{quote}”
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
        {kind === "web_article" ? (
          <Globe className="h-3.5 w-3.5 shrink-0 text-blue-600" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-800" title={title}>{title}</div>
        {evidence?.sourceUrl || citation?.sourceUrl ? (
          <a
            href={evidence?.sourceUrl || citation?.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-[220px] truncate rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-mono text-[10px] text-blue-800 hover:border-blue-400"
            title={evidence?.sourceUrl || citation?.sourceUrl}
          >
            {(evidence?.sourceUrl || citation?.sourceUrl || "").replace(/^https?:\/\//, "")}
          </a>
        ) : null}
        {kind === "pdf" && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-7 rounded-md border border-slate-200 px-2 text-[11px] disabled:opacity-40">‹</button>
            <span className="font-mono text-[10.5px] tracking-wide text-slate-500">Page {page} of {pageCount}</span>
            <button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="h-7 rounded-md border border-slate-200 px-2 text-[11px] disabled:opacity-40">›</button>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600"><Minus className="h-3 w-3" /></button>
          <button type="button" onClick={() => { setZoom(1); setFitToken((n) => n + 1); }}
            className="h-7 rounded-md border border-slate-200 px-2 font-mono text-[10px] tracking-wide text-slate-600">Fit</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600"><Plus className="h-3 w-3" /></button>
        </div>
        {showClose && onClose && (
          <button type="button" onClick={onClose} className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50">
            <X className="h-3 w-3" />Close Inspector
          </button>
        )}
      </header>
      {approxBanner}
      {pdfError && !blobUrl && (
        <div className="mx-3 mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">{pdfError}</div>
      )}
      {pdfError && blobUrl && (
        <div className="mx-3 mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Canvas preview failed — showing the native PDF viewer.
        </div>
      )}
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-auto bg-slate-50">
        {busy && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" />Rendering
          </div>
        )}
        {!evidence && (kind === "external_intel" || citation?.sourceType === "external_intel") ? (
          <div className="mx-auto max-w-[62ch] px-4 py-6 sm:px-8 sm:py-8">
            <h2 className="mb-2 text-[22px] font-semibold tracking-tight">{title}</h2>
            <blockquote className="border-l-2 border-amber-300 pl-3 text-[16px] leading-[1.8] text-slate-700">
              “{citation?.exactQuote || "No verbatim quote stored."}”
            </blockquote>
          </div>
        ) : !evidence ? (
          <div className="px-6 py-16 text-center text-[13px] text-slate-500">No source file is attached to this citation.</div>
        ) : kind === "pdf" && pdfError && blobUrl ? (
          <iframe src={blobUrl} className="h-full min-h-[70vh] w-full rounded border-0 bg-white" title="PDF Preview" />
        ) : kind === "pdf" && (evidence.fileBase64 || blobUrl) ? (
          <div className="flex justify-center p-4" style={{ transform: `scale(${zoom === 1 ? 1 : 1})` }}>
            <div className="relative" style={{ width: canvasSize.w || undefined }}>
              <canvas ref={canvasRef} className="max-w-full rounded-md border border-slate-200 bg-white shadow-sm" />
              <div className="absolute inset-0">
                {pdfBoxes.map((box, i) => (
                  <button
                    key={`${box.id}-${i}`}
                    type="button"
                    id={i === 0 || box.id === (activeId || "focus") ? `source-hit-${box.id}` : undefined}
                    onClick={() => onSelectAnchor?.(box.id)}
                    className={`absolute rounded-sm border-2 ${box.id === (activeId || "focus") ? "border-amber-500 bg-amber-300/35 shadow-[0_0_12px_rgba(245,158,11,0.55)]" : "border-amber-300/80 bg-amber-200/25"}`}
                    style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${Math.max(box.height, 1.2)}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : kind === "pdf" && !evidence.fileBase64 ? (
          <div className="px-6 py-16 text-center text-[13px] text-slate-500">This PDF has no stored file bytes in the local vault.</div>
        ) : kind === "image" && imageSrc ? (
          <div className="flex justify-center p-4">
            <div className="relative inline-block max-w-full" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
              <img src={imageSrc} alt={title} className="max-h-[70vh] max-w-full rounded-md border border-slate-200 bg-slate-100 object-contain" />
              {imageBoxes.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  id={`source-hit-${box.id}`}
                  onClick={() => onSelectAnchor?.(box.id)}
                  className={`absolute rounded-sm border-2 ${box.id === (activeId || "focus") ? "border-amber-500 bg-amber-300/30 shadow-[0_0_16px_rgba(245,158,11,0.6)]" : "border-amber-400/70 bg-amber-200/20"}`}
                  style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[62ch] px-4 py-6 sm:px-8 sm:py-8" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <h2 className="mb-4 text-[22px] font-semibold tracking-tight">{title}</h2>
            <p className="whitespace-pre-wrap text-[16px] leading-[1.8] text-slate-700">
              {textSegments.length ? textSegments.map((part) => {
                if (part.type === "text") return <span key={part.key}>{part.value}</span>;
                const active = part.draftId === (activeId || "focus");
                return (
                  <mark
                    key={part.key}
                    id={`source-hit-${part.draftId}`}
                    onClick={() => onSelectAnchor?.(part.draftId)}
                    className={active ? MARK_ACTIVE : MARK}
                  >
                    {part.value}
                  </mark>
                );
              }) : (evidence.rawText || "This source has no stored text layer.")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
