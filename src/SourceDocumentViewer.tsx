import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Globe, Loader2, Minus, Plus, Radio, X } from "lucide-react";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { pdfBlobFromBytes, pdfBytesFromBase64 } from "./lib/pdfjsSetup";
import { db, type EvidenceRecord } from "./db";
import { collectQuoteSpans, locateCardHighlight, locateSnippet, splitTextBySpans, type QuoteSegment } from "./lib/quoteAnchors";
import { articleBodyReady } from "./lib/scrapeClient";
import { cropImageRegion, evidenceImageSrc } from "./lib/imageEvidence";
import PdfScrollPages from "./PdfScrollPages";
import { documentText } from "./lib/pdfParser";
import { reportPages } from "./data/caseFixtures";
import {
  citationPillLabel,
  inferSourceType,
  type SourceBoundingBox,
  type SourceCitation,
} from "./types";

const MARK =
  "extract-hit cursor-pointer rounded px-0.5 bg-yellow-200/70 text-inherit box-decoration-clone transition-colors duration-200 hover:bg-yellow-300";
const MARK_ACTIVE =
  "extract-hit extract-hit-active cursor-pointer rounded bg-amber-400 px-0.5 text-slate-900 shadow-md ring-2 ring-amber-600 transition-colors duration-200";

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

type OverlayBox = SourceBoundingBox & { id: string; title?: string };

type ViewerAnchor = {
  id: string;
  citation: SourceCitation;
  label?: string;
  entityName?: string;
};

function groupParagraphs(segments: QuoteSegment[]) {
  const blocks: QuoteSegment[][] = [[]];
  for (const part of segments) {
    if (part.type !== "text") {
      blocks[blocks.length - 1].push(part);
      continue;
    }
    const chunks = part.value.split(/\n{2,}|\n/);
    chunks.forEach((chunk, index) => {
      if (index > 0) blocks.push([]);
      if (chunk.trim()) blocks[blocks.length - 1].push({ ...part, key: `${part.key}-${index}`, value: chunk.trim() });
    });
  }
  return blocks.filter((block) => block.some((part) => part.value.trim()));
}

type Props = {
  evidence: EvidenceRecord | null;
  citation: SourceCitation | null;
  anchors?: ViewerAnchor[];
  activeId?: string | null;
  onClose?: () => void;
  onSelectAnchor?: (id: string) => void;
  showClose?: boolean;
  onImageRegionSelect?: (payload: { box: SourceBoundingBox; previewDataUrl: string; x: number; y: number }) => void;
  onTextSelect?: (payload: { text: string; x: number; y: number; pageNumber?: number }) => void;
  onVisiblePage?: (page: number) => void;
  highlightTerms?: string[];
  onPasteArticle?: (text: string) => void | Promise<void>;
};

export default function SourceDocumentViewer({
  evidence,
  citation,
  anchors = [],
  activeId,
  onClose,
  onSelectAnchor,
  showClose = true,
  onImageRegionSelect,
  onTextSelect,
  onVisiblePage,
  highlightTerms = [],
  onPasteArticle,
}: Props) {
  const kind = evidence ? inferSourceType(evidence) : citation?.sourceType ?? "text";
  const title = evidence?.fileName || citation?.sourceName || "Source";
  const [pageCount, setPageCount] = useState(evidence?.pageCount || 1);
  const [zoom, setZoom] = useState(1);
  const [matched, setMatched] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<SourceBoundingBox | null>(null);
  const [imgTip, setImgTip] = useState<{ x: number; y: number; title: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteBusy, setPasteBusy] = useState(false);

  const focus = citation;
  const quote = (focus?.exactQuote || "").trim();
  const anchorSig = anchors.map((a) => `${a.id}:${a.citation.exactQuote}:${a.citation.pageNumber ?? ""}:${a.entityName ?? ""}`).join("|");

  useEffect(() => {
    if (citation?.pageNumber) {
      window.setTimeout(() => {
        document.getElementById(`pdf-page-${citation.pageNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  }, [citation?.sourceId, citation?.pageNumber, citation?.exactQuote]);

  useEffect(() => {
    let cancelled = false;
    const evidenceId = evidence?.id;
    if (kind !== "pdf" || !evidenceId) {
      void pdfRef.current?.cleanup();
      pdfRef.current = null;
      setPdfDoc(null);
      setPdfError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setPdfError(null);
    void (async () => {
      try {
        const sourceRecord = await db.evidence.get(evidenceId);
        const raw = sourceRecord?.fileBase64 || evidence?.fileBase64 || "";
        if (!sourceRecord || !raw) {
          if (!cancelled) {
            setPdfDoc(null);
            setPdfError(documentText(sourceRecord) ? null : "Missing raw PDF data in the local vault.");
          }
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
        setPdfDoc(doc);
        setPageCount(doc.numPages);
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
    setPdfDoc(null);
  }, []);

  const sourcePlain = documentText(evidence) || evidence?.rawText || "";
  const pagedTranscript = useMemo(() => reportPages(sourcePlain), [sourcePlain]);
  const showPagedTranscript = kind === "pdf" && !pdfDoc && pagedTranscript.length > 1;
  const bodyReady = kind !== "web_article" || articleBodyReady(sourcePlain);
  const termSig = highlightTerms.join("|");
  const textSegments = useMemo(() => {
    if (!sourcePlain) return [];
    const drafts = [
      ...(quote ? [{ id: activeId || "focus", snippet: quote, exactQuote: quote }] : []),
      ...anchors.map((a) => ({
        id: a.id,
        snippet: a.citation.exactQuote,
        title: a.label,
        exactQuote: a.citation.exactQuote,
        anchorText: a.entityName,
      })),
    ];
    const spans = collectQuoteSpans(sourcePlain, drafts);
    if (kind === "web_article") {
      for (const term of highlightTerms) {
        const loc = locateSnippet(sourcePlain, term);
        if (!loc || spans.some((span) => loc.start < span.end && loc.end > span.start)) continue;
        const owner = anchors.find((anchor) => `${anchor.entityName || ""} ${anchor.label || ""} ${anchor.citation.exactQuote}`
          .toLowerCase()
          .includes(term.toLowerCase()));
        spans.push({ draftId: owner?.id || `term-${term}`, start: loc.start, end: loc.end });
      }
      spans.sort((a, b) => a.start - b.start);
    }
    return splitTextBySpans(sourcePlain, spans);
  }, [sourcePlain, quote, anchorSig, activeId, kind, termSig]);

  useEffect(() => {
    if ((kind === "text" || kind === "external_intel" || kind === "web_article") && quote && sourcePlain) {
      setMatched(Boolean(locateCardHighlight(sourcePlain, { quote, exactQuote: quote })));
    }
  }, [kind, quote, sourcePlain]);

  useEffect(() => {
    const el = document.getElementById(`source-hit-${activeId || "focus"}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeId, quote, textSegments]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !onTextSelect) return;
    const handle = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const node = sel.anchorNode ?? sel.focusNode;
      const host = node instanceof Element ? node : node?.parentElement;
      if (!host || !el.contains(host)) return;
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const pageEl = host.closest("[data-pdf-page]");
      const pageNumber = Number(pageEl?.getAttribute("data-pdf-page"));
      onTextSelect({
        text,
        x: Math.min(window.innerWidth - 24, Math.max(24, rect.left + (rect.width || 0) / 2)),
        y: Math.max(12, (rect.top || 0) - 8),
        pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
      });
    };
    el.addEventListener("mouseup", handle);
    el.addEventListener("touchend", handle);
    return () => {
      el.removeEventListener("mouseup", handle);
      el.removeEventListener("touchend", handle);
    };
  }, [onTextSelect]);

  const imageSrc = evidence ? (evidence.imageBase64 || evidence.fileBase64 || evidenceImageSrc(evidence)) : "";
  const imageBoxes: OverlayBox[] = [];
  if (kind === "image") {
    if (focus?.boundingBox) {
      imageBoxes.push({ id: activeId || "focus", ...focus.boundingBox, title: focus.exactQuote });
    }
    for (const a of anchors) {
      if (a.citation.boundingBox) {
        imageBoxes.push({
          id: a.id,
          ...a.citation.boundingBox,
          title: [a.citation.exactQuote, a.citation.sourceName].filter(Boolean).join(" — "),
        });
      }
    }
  }

  const pctFromPointer = (clientX: number, clientY: number) => {
    const el = imageWrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((clientX - r.left) / Math.max(r.width, 1)) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - r.top) / Math.max(r.height, 1)) * 100)),
    };
  };

  const boxFromPoints = (a: { x: number; y: number }, b: { x: number; y: number }): SourceBoundingBox => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const approxBanner = !matched && quote ? (
    <div className="mx-3 mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      Approximate citation location{citation?.pageNumber ? ` on page ${citation.pageNumber}` : ""}. Matched text: “{quote}”
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
          <span className="font-mono text-[10.5px] tracking-wide text-slate-500">
            {pageCount} {pageCount === 1 ? "page" : "pages"} · scroll
          </span>
        )}
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600"><Minus className="h-3 w-3" /></button>
          <button type="button" onClick={() => setZoom(1)}
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
      {kind === "web_article" && !bodyReady && (
        <div className="mx-3 mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>Unable to scrape full body from publisher. Paste article text manually to extract.</p>
            <button
              type="button"
              onClick={() => setPasteOpen((open) => !open)}
              className="inline-flex h-8 shrink-0 items-center rounded-[8px] border border-amber-400 bg-white px-2.5 text-[12px] font-semibold text-amber-950 hover:bg-amber-100"
            >
              Paste Text
            </button>
          </div>
          {pasteOpen && (
            <form
              className="mt-2 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = pasteValue.trim();
                if (text.length < 12 || !onPasteArticle) return;
                setPasteBusy(true);
                void Promise.resolve(onPasteArticle(text)).finally(() => {
                  setPasteBusy(false);
                  setPasteOpen(false);
                  setPasteValue("");
                });
              }}
            >
              <textarea
                value={pasteValue}
                onChange={(event) => setPasteValue(event.target.value)}
                rows={8}
                placeholder="Paste the article text"
                className="w-full rounded-[8px] border border-amber-200 bg-white px-2.5 py-2 text-[13px] leading-relaxed text-slate-800 outline-none"
              />
              <button
                type="submit"
                disabled={pasteBusy || pasteValue.trim().length < 12}
                className="h-8 self-end rounded-[8px] bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                {pasteBusy ? "Saving…" : "Save article text"}
              </button>
            </form>
          )}
        </div>
      )}
      {approxBanner}
      {kind === "pdf" && pdfError && !blobUrl && (
        <div className="mx-3 mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">{pdfError}</div>
      )}
      {kind === "pdf" && pdfError && blobUrl && (
        <div className="mx-3 mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Canvas preview failed — showing the native PDF viewer.
        </div>
      )}
      <div ref={stageRef} data-pdf-scroll className="relative min-h-0 max-h-[80vh] flex-1 overflow-y-auto bg-slate-50">
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
        ) : kind === "pdf" && (evidence.fileBase64 || blobUrl) && pdfDoc ? (
          <PdfScrollPages
            pdf={pdfDoc}
            pageCount={pageCount}
            zoom={zoom}
            citation={citation}
            anchors={anchors}
            activeId={activeId}
            onSelectAnchor={onSelectAnchor}
            onVisiblePage={onVisiblePage}
          />
        ) : kind === "pdf" && (evidence.fileBase64 || blobUrl) && busy ? (
          <div className="flex min-h-[50vh] items-center justify-center text-[13px] text-slate-500">Loading pages…</div>
        ) : kind === "pdf" && !evidence.fileBase64 && !showPagedTranscript ? (
          <div className="px-6 py-16 text-center text-[13px] text-slate-500">This PDF has no stored file bytes in the local vault.</div>
        ) : showPagedTranscript ? (
          <div className="flex w-full flex-col items-center gap-4 p-4">
            {pagedTranscript.map((block) => {
              const drafts = anchors
                .filter((anchor) => !anchor.citation.pageNumber || anchor.citation.pageNumber === block.page)
                .map((anchor) => ({
                  id: anchor.id,
                  snippet: anchor.citation.exactQuote,
                  exactQuote: anchor.citation.exactQuote,
                  title: anchor.label,
                }));
              const segments = splitTextBySpans(block.body, collectQuoteSpans(block.body, drafts));
              return (
                <article
                  key={block.page}
                  id={`pdf-page-${block.page}`}
                  data-pdf-page={block.page}
                  data-page-number={block.page}
                  className="w-full max-w-[920px] rounded-md border border-slate-200 bg-white p-8 shadow-sm"
                >
                  <p className="mb-4 font-mono text-[11px] tracking-[0.14em] text-slate-400">PAGE {block.page}</p>
                  <p className="select-text whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-800">
                    {segments.map((part) => {
                      if (part.type === "text") return <span key={part.key}>{part.value}</span>;
                      const active = part.draftId === (activeId || "focus");
                      return (
                        <mark
                          key={part.key}
                          id={active || part.draftId ? `source-hit-${part.draftId}` : undefined}
                          data-verify-quote={part.draftId}
                          data-finding-id={part.draftId}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectAnchor?.(part.draftId);
                          }}
                          className={active ? MARK_ACTIVE : MARK}
                          style={{ pointerEvents: "auto" }}
                        >
                          {part.value}
                        </mark>
                      );
                    })}
                  </p>
                </article>
              );
            })}
          </div>
        ) : kind === "image" && imageSrc ? (
          <div className="flex flex-col items-center p-4">
            {onImageRegionSelect && (
              <p className="mb-2 text-center text-[11.5px] text-slate-500">Drag across the image to highlight a jacket, plate, landmark, or other region.</p>
            )}
            <div
              ref={imageWrapRef}
              className={`relative inline-block max-w-full ${onImageRegionSelect ? "cursor-crosshair" : ""}`}
              style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
              onMouseMove={(e) => {
                const wrap = imageWrapRef.current;
                if (!wrap || !imageBoxes.length) return;
                const r = wrap.getBoundingClientRect();
                const x = ((e.clientX - r.left) / Math.max(r.width, 1)) * 100;
                const y = ((e.clientY - r.top) / Math.max(r.height, 1)) * 100;
                const hit = [...imageBoxes].reverse().find((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
                setImgTip(hit?.title ? { x: e.clientX, y: e.clientY, title: hit.title } : null);
              }}
              onMouseLeave={() => setImgTip(null)}
              onPointerDown={(e) => {
                if (!onImageRegionSelect) return;
                if ((e.target as HTMLElement).closest("[data-bbox-hit]")) return;
                e.preventDefault();
                const origin = pctFromPointer(e.clientX, e.clientY);
                dragOrigin.current = origin;
                setDraftBox({ ...origin, width: 0, height: 0 });
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!dragOrigin.current) return;
                setDraftBox(boxFromPoints(dragOrigin.current, pctFromPointer(e.clientX, e.clientY)));
              }}
              onPointerUp={(e) => {
                if (!onImageRegionSelect || !dragOrigin.current) return;
                e.stopPropagation();
                const box = boxFromPoints(dragOrigin.current, pctFromPointer(e.clientX, e.clientY));
                dragOrigin.current = null;
                setDraftBox(null);
                if (box.width < 1.8 || box.height < 1.8) return;
                void cropImageRegion(imageSrc, box).then((previewDataUrl) => {
                  onImageRegionSelect({ box, previewDataUrl, x: e.clientX, y: e.clientY });
                }).catch(() => {
                  onImageRegionSelect({ box, previewDataUrl: imageSrc, x: e.clientX, y: e.clientY });
                });
              }}
            >
              <img src={imageSrc} alt={title} draggable={false} className="pointer-events-none max-h-[70vh] max-w-full rounded-md border border-slate-200 bg-slate-100 object-contain" />
              {imageBoxes.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  data-bbox-hit
                  id={`source-hit-${box.id}`}
                  title={box.title || "Logged observation"}
                  onClick={() => onSelectAnchor?.(box.id)}
                  className={`absolute rounded-sm border-2 ${box.id === (activeId || "focus") ? "border-amber-500 bg-amber-400/40 shadow-sm" : "border-amber-400/70 bg-amber-400/20"}`}
                  style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}
                />
              ))}
              {draftBox && draftBox.width > 0 && (
                <div
                  className="pointer-events-none absolute rounded-sm border-2 border-dashed border-blue-500 bg-blue-400/20"
                  style={{ left: `${draftBox.x}%`, top: `${draftBox.y}%`, width: `${draftBox.width}%`, height: `${draftBox.height}%` }}
                />
              )}
              {imgTip ? (
                <div
                  className="pointer-events-none fixed z-[70] max-w-xs rounded-md border border-amber-200 bg-white px-2 py-1.5 text-[11.5px] text-amber-950 shadow-lg"
                  style={{ left: imgTip.x + 12, top: imgTip.y + 12 }}
                >
                  {imgTip.title}
                </div>
              ) : null}
            </div>
          </div>
        ) : kind === "web_article" && !bodyReady ? (
          <div className="px-8 py-10 text-[13px] text-slate-500">The publisher page did not return a readable article.</div>
        ) : kind === "web_article" ? (
          <article className="prose prose-slate dark:prose-invert article-prose max-w-none p-8 text-sm leading-relaxed" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <h2 className="mb-4 text-[22px] font-semibold tracking-tight text-slate-900">{title}</h2>
            {groupParagraphs(textSegments).map((block, index) => (
              <p key={block[0]?.key || index} className="select-text">
                {block.map((part) => {
                  if (part.type === "text") return <span key={part.key}>{part.value}</span>;
                  const active = part.draftId === (activeId || "focus");
                  return (
                    <mark
                      key={part.key}
                      id={`source-hit-${part.draftId}`}
                      data-verify-quote={part.draftId}
                      data-finding-id={part.draftId}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectAnchor?.(part.draftId);
                      }}
                      className={`${active ? MARK_ACTIVE : MARK}`}
                      style={{ pointerEvents: "auto" }}
                    >
                      {part.value}
                    </mark>
                  );
                })}
              </p>
            ))}
          </article>
        ) : (
          <div className="mx-auto max-w-[62ch] px-4 py-6 sm:px-8 sm:py-8" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <h2 className="mb-4 text-[22px] font-semibold tracking-tight">{title}</h2>
            <p className="select-text whitespace-pre-wrap text-[16px] leading-[1.8] text-slate-700">
              {textSegments.length ? textSegments.map((part) => {
                if (part.type === "text") return <span key={part.key}>{part.value}</span>;
                const active = part.draftId === (activeId || "focus");
                return (
                  <mark
                    key={part.key}
                    id={`source-hit-${part.draftId}`}
                    data-verify-quote={part.draftId}
                    data-finding-id={part.draftId}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectAnchor?.(part.draftId);
                    }}
                    className={active ? MARK_ACTIVE : MARK}
                    style={{ pointerEvents: "auto" }}
                  >
                    {part.value}
                  </mark>
                );
              }) : (sourcePlain || "This source has no stored text layer.")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
