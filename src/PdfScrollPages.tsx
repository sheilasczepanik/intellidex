import { useEffect, useRef, useState } from "react";
import { TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import { locateCardHighlight } from "./lib/quoteAnchors";
import type { SourceCitation } from "./types";

type QuoteAnchor = { id: string; quote: string; pageNumber?: number; title?: string };

const MARK_CLS = "extract-hit cursor-pointer rounded px-0.5 bg-yellow-200/70 transition-colors duration-200 hover:bg-yellow-300";
const MARK_ACTIVE_CLS = "extract-hit extract-hit-active cursor-pointer rounded bg-amber-400 px-0.5 text-slate-900 shadow-md ring-2 ring-amber-600 transition-colors duration-200";

function paintMarks(
  layerEl: HTMLDivElement,
  quotes: QuoteAnchor[],
  activeId?: string | null,
  onSelectAnchor?: (id: string) => void,
) {
  const nodeSpans = [...layerEl.querySelectorAll("span")].filter((el) => (el.textContent || "").trim());
  let hay = "";
  const spanMap = nodeSpans.map((el) => {
    const start = hay.length;
    hay += el.textContent || "";
    const rec = { start, end: hay.length, el };
    hay += " ";
    return rec;
  });
  const firstMarked = new Set<string>();
  for (const a of quotes) {
    const loc = locateCardHighlight(hay, { quote: a.quote, exactQuote: a.quote, title: a.title });
    if (!loc) continue;
    const active = a.id === (activeId || "focus");
    for (const span of spanMap) {
      if (span.end <= loc.start || span.start >= loc.end) continue;
      if (span.el.querySelector("mark[data-verify-quote]")) continue;
      const mark = document.createElement("mark");
      mark.className = active ? MARK_ACTIVE_CLS : MARK_CLS;
      mark.setAttribute("data-verify-quote", a.id);
      mark.setAttribute("data-finding-id", a.id);
      mark.style.pointerEvents = "auto";
      mark.title = a.title || a.quote;
      if (!firstMarked.has(a.id)) {
        mark.id = `source-hit-${a.id}`;
        firstMarked.add(a.id);
      }
      while (span.el.firstChild) mark.appendChild(span.el.firstChild);
      span.el.appendChild(mark);
      mark.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectAnchor?.(a.id);
      });
    }
  }
}

function PdfPage({
  pdf,
  pageNumber,
  zoom,
  hostWidth,
  quotes,
  activeId,
  onSelectAnchor,
  onVisiblePage,
  eager,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  hostWidth: number;
  quotes: QuoteAnchor[];
  activeId?: string | null;
  onSelectAnchor?: (id: string) => void;
  onVisiblePage?: (page: number) => void;
  eager: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const visiblePageCb = useRef(onVisiblePage);
  visiblePageCb.current = onVisiblePage;
  const [visible, setVisible] = useState(eager);
  const [size, setSize] = useState({ w: 0, h: 720 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          if ((entry.intersectionRatio || 0) >= 0.35) visiblePageCb.current?.(pageNumber);
        }
      },
      { root: el.closest("[data-pdf-scroll]"), rootMargin: "600px 0px", threshold: [0.01, 0.35, 0.6] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber]);

  const quoteKey = quotes.map((q) => `${q.id}:${q.quote}:${q.pageNumber ?? ""}`).join("|");

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const layerEl = textLayerRef.current;
    if (!canvas || !layerEl) return;
    let cancelled = false;
    let layer: TextLayer | null = null;
    void (async () => {
      try {
        const pg = await pdf.getPage(pageNumber);
        const base = pg.getViewport({ scale: 1 });
        const fitScale = Math.max(0.35, ((hostWidth || 720) - 40) / base.width);
        const viewport = pg.getViewport({ scale: zoom * fitScale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        if (!cancelled) setSize({ w: viewport.width, h: viewport.height });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        const content = await pg.getTextContent();
        layerEl.replaceChildren();
        layerEl.style.width = `${viewport.width}px`;
        layerEl.style.height = `${viewport.height}px`;
        layer = new TextLayer({ textContentSource: content, container: layerEl, viewport });
        await layer.render();
        if (cancelled) return;
        paintMarks(layerEl, quotes, activeId, onSelectAnchor);
      } catch {
        /* keep placeholder */
      }
    })();
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [visible, pdf, pageNumber, zoom, hostWidth, quoteKey, onSelectAnchor]);

  useEffect(() => {
    const layerEl = textLayerRef.current;
    if (!layerEl) return;
    layerEl.querySelectorAll("mark[data-verify-quote]").forEach((node) => {
      const mark = node as HTMLElement;
      const id = mark.getAttribute("data-verify-quote");
      const active = id === (activeId || "focus");
      mark.className = active ? MARK_ACTIVE_CLS : MARK_CLS;
    });
    if (activeId) {
      layerEl.querySelector<HTMLElement>(`#source-hit-${CSS.escape(activeId)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeId, visible, quoteKey]);

  return (
    <div
      ref={wrapRef}
      id={`pdf-page-${pageNumber}`}
      data-pdf-page={pageNumber}
      data-page-number={pageNumber}
      className="relative w-full max-w-[920px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
      style={{ minHeight: size.h || 720 }}
    >
      {visible ? (
        <>
          <canvas ref={canvasRef} className="pointer-events-none block h-auto w-full bg-white" />
          <div ref={textLayerRef} className="pdf-text-layer" />
        </>
      ) : (
        <div className="flex h-[720px] items-center justify-center text-[12px] text-slate-400">Page {pageNumber}</div>
      )}
    </div>
  );
}

export default function PdfScrollPages({
  pdf,
  pageCount,
  zoom,
  citation,
  anchors,
  activeId,
  onSelectAnchor,
  onVisiblePage,
}: {
  pdf: PDFDocumentProxy;
  pageCount: number;
  zoom: number;
  citation: SourceCitation | null;
  anchors: { id: string; citation: SourceCitation; label?: string }[];
  activeId?: string | null;
  onSelectAnchor?: (id: string) => void;
  onVisiblePage?: (page: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(720);
  const quotes: QuoteAnchor[] = [
    ...(citation?.exactQuote ? [{
      id: activeId || "focus",
      quote: citation.exactQuote,
      pageNumber: citation.pageNumber,
      title: anchors.find((a) => a.id === activeId)?.label,
    }] : []),
    ...anchors.filter((a) => a.id !== activeId).map((a) => ({
      id: a.id,
      quote: a.citation.exactQuote,
      pageNumber: a.citation.pageNumber,
      title: a.label,
    })),
  ];

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setHostWidth(el.clientWidth || 720);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const page = citation?.pageNumber;
    if (!page) return;
    const t = window.setTimeout(() => {
      const hit = document.getElementById(`source-hit-${activeId || "focus"}`);
      if (hit) hit.scrollIntoView({ behavior: "smooth", block: "center" });
      else document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [citation?.pageNumber, citation?.exactQuote, activeId]);

  return (
    <div ref={hostRef} className="flex w-full flex-col items-center gap-4 p-4">
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
        <PdfPage
          key={n}
          pdf={pdf}
          pageNumber={n}
          zoom={zoom}
          hostWidth={hostWidth}
          quotes={quotes.filter((quote) => !quote.pageNumber || quote.pageNumber === n)}
          activeId={activeId}
          onSelectAnchor={onSelectAnchor}
          onVisiblePage={onVisiblePage}
          eager={n <= 2 || n === (citation?.pageNumber || 1)}
        />
      ))}
    </div>
  );
}
