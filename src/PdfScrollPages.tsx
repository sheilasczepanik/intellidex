import { useEffect, useRef, useState } from "react";
import { TextLayer, Util, type PDFDocumentProxy } from "pdfjs-dist";
import { locateSnippet } from "./lib/quoteAnchors";
import type { SourceBoundingBox, SourceCitation } from "./types";

type OverlayBox = SourceBoundingBox & { id: string; title?: string };

type QuoteAnchor = { id: string; quote: string; pageNumber?: number; title?: string };

function PdfPage({
  pdf,
  pageNumber,
  zoom,
  hostWidth,
  quotes,
  activeId,
  onSelectAnchor,
  eager,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  hostWidth: number;
  quotes: QuoteAnchor[];
  activeId?: string | null;
  onSelectAnchor?: (id: string) => void;
  eager: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  const [size, setSize] = useState({ w: 0, h: 720 });
  const [boxes, setBoxes] = useState<OverlayBox[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; title: string } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { root: el.closest("[data-pdf-scroll]"), rootMargin: "600px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

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
        const items = content.items.flatMap((it) => {
          if (typeof it !== "object" || !it || !("str" in it) || !("transform" in it)) return [];
          const row = it as { str: string; transform: number[]; width: number; height: number };
          return row.str ? [row] : [];
        });
        let hay = "";
        const spans: { start: number; end: number; item: (typeof items)[number] }[] = [];
        for (const item of items) {
          const start = hay.length;
          hay += item.str;
          spans.push({ start, end: hay.length, item });
          hay += " ";
        }
        const next: OverlayBox[] = [];
        const toBox = (item: (typeof items)[number], id: string, title?: string): OverlayBox => {
          const tx = Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(tx[2], tx[3]);
          const width = item.width * Math.hypot(tx[0], tx[1]);
          return {
            id,
            title,
            x: (tx[4] / viewport.width) * 100,
            y: ((tx[5] - height) / viewport.height) * 100,
            width: (width / viewport.width) * 100,
            height: (height / viewport.height) * 100,
          };
        };
        for (const a of quotes) {
          if (a.pageNumber && a.pageNumber !== pageNumber) continue;
          const loc = locateSnippet(hay, a.quote);
          if (!loc) continue;
          for (const span of spans) {
            if (span.end > loc.start && span.start < loc.end) next.push(toBox(span.item, a.id, a.title || a.quote));
          }
        }
        if (!cancelled) setBoxes(next);
      } catch {
        /* keep placeholder */
      }
    })();
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [visible, pdf, pageNumber, zoom, hostWidth, quoteKey, activeId]);

  return (
    <div
      ref={wrapRef}
      id={`pdf-page-${pageNumber}`}
      data-pdf-page={pageNumber}
      className="relative w-full max-w-[920px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
      style={{ minHeight: size.h || 720 }}
      onMouseMove={(e) => {
        const wrap = wrapRef.current;
        if (!wrap || !boxes.length) return;
        const r = wrap.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        const hit = [...boxes].reverse().find((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + Math.max(b.height, 1.2));
        setTip(hit?.title ? { x: e.clientX, y: e.clientY, title: hit.title } : null);
      }}
      onMouseLeave={() => setTip(null)}
    >
      {visible ? (
        <>
          <canvas ref={canvasRef} className="pointer-events-none block h-auto w-full bg-white" />
          <div className="pointer-events-none absolute inset-0 z-[1]">
            {boxes.map((box, i) => (
              <button
                key={`${box.id}-${i}`}
                type="button"
                id={box.id === (activeId || "focus") ? `source-hit-${box.id}` : undefined}
                onClick={() => onSelectAnchor?.(box.id)}
                className={`pointer-events-none absolute rounded-sm border-2 ${box.id === (activeId || "focus") ? "border-amber-500 bg-amber-300/35" : "border-amber-300/80 bg-amber-200/25"}`}
                style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${Math.max(box.height, 1.2)}%` }}
              />
            ))}
          </div>
          <div ref={textLayerRef} className="pdf-text-layer" />
        </>
      ) : (
        <div className="flex h-[720px] items-center justify-center text-[12px] text-slate-400">Page {pageNumber}</div>
      )}
      {tip && (
        <div
          className="pointer-events-none fixed z-[70] max-w-xs rounded-md border border-amber-200 bg-white px-2 py-1.5 text-[11.5px] text-amber-950 shadow-lg"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
        >
          {tip.title}
        </div>
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
}: {
  pdf: PDFDocumentProxy;
  pageCount: number;
  zoom: number;
  citation: SourceCitation | null;
  anchors: { id: string; citation: SourceCitation }[];
  activeId?: string | null;
  onSelectAnchor?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(720);
  const quotes: QuoteAnchor[] = [
    ...(citation?.exactQuote ? [{ id: activeId || "focus", quote: citation.exactQuote, pageNumber: citation.pageNumber, title: citation.exactQuote }] : []),
    ...anchors.filter((a) => a.id !== activeId).map((a) => ({
      id: a.id,
      quote: a.citation.exactQuote,
      pageNumber: a.citation.pageNumber,
      title: a.citation.exactQuote,
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
      document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          quotes={quotes}
          activeId={activeId}
          onSelectAnchor={onSelectAnchor}
          eager={n <= 2 || n === (citation?.pageNumber || 1)}
        />
      ))}
    </div>
  );
}
