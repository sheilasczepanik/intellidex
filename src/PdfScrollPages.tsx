import { useEffect, useRef, useState } from "react";
import { TextLayer, Util, type PDFDocumentProxy } from "pdfjs-dist";
import { locateCardHighlight } from "./lib/quoteAnchors";
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
        const toBox = (
          item: (typeof items)[number],
          span: { start: number; end: number },
          loc: { start: number; end: number },
          id: string,
          title?: string,
        ): OverlayBox | null => {
          const overlapStart = Math.max(loc.start, span.start);
          const overlapEnd = Math.min(loc.end, span.end);
          const chars = Math.max(item.str.length, 1);
          const i0 = Math.max(0, overlapStart - span.start);
          const i1 = Math.min(chars, overlapEnd - span.start);
          if (i1 - i0 < 1) return null;
          const tx = Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(tx[2], tx[3]);
          const fullWidth = item.width * Math.hypot(tx[0], tx[1]);
          const clippedWidth = fullWidth * ((i1 - i0) / chars);
          const clippedX = tx[4] + fullWidth * (i0 / chars);
          const widthPct = (clippedWidth / viewport.width) * 100;
          const heightPct = (height / viewport.height) * 100;
          if (widthPct < 0.12 || heightPct < 0.12) return null;
          if (widthPct > 72 && (i1 - i0) < 28) return null;
          return {
            id,
            title,
            x: (clippedX / viewport.width) * 100,
            y: ((tx[5] - height) / viewport.height) * 100,
            width: widthPct,
            height: heightPct,
          };
        };
        const mergeBoxes = (raw: OverlayBox[]) => {
          const grouped = new Map<string, OverlayBox[]>();
          for (const box of raw) {
            const list = grouped.get(box.id) ?? [];
            list.push(box);
            grouped.set(box.id, list);
          }
          const merged: OverlayBox[] = [];
          for (const [id, list] of grouped) {
            const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
            let cur: OverlayBox | null = null;
            for (const box of sorted) {
              if (
                cur
                && Math.abs(cur.y - box.y) < 0.45
                && Math.abs(cur.height - box.height) < 0.45
                && box.x <= cur.x + cur.width + 0.7
              ) {
                const right = Math.max(cur.x + cur.width, box.x + box.width);
                cur = { ...cur, x: Math.min(cur.x, box.x), width: right - Math.min(cur.x, box.x), height: Math.max(cur.height, box.height) };
              } else {
                if (cur) merged.push(cur);
                cur = { ...box, id };
              }
            }
            if (cur) merged.push(cur);
          }
          return merged;
        };
        for (const a of quotes) {
          const loc = locateCardHighlight(hay, { quote: a.quote, exactQuote: a.quote, title: a.title });
          if (!loc) continue;
          for (const span of spans) {
            if (span.end <= loc.start || span.start >= loc.end) continue;
            const box = toBox(span.item, span, loc, a.id, a.title || a.quote);
            if (box) next.push(box);
          }
        }
        if (!cancelled) setBoxes(mergeBoxes(next));
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
      onClick={(e) => {
        if (!onSelectAnchor || !boxes.length) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) return;
        const wrap = wrapRef.current;
        if (!wrap) return;
        const r = wrap.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        const hit = [...boxes].reverse().find((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
        if (hit) onSelectAnchor(hit.id);
      }}
    >
      {visible ? (
        <>
          <canvas ref={canvasRef} className="pointer-events-none block h-auto w-full bg-white" />
          <div className="pointer-events-none absolute inset-0 z-[1]">
            {boxes.map((box, i) => {
              const active = box.id === (activeId || "focus");
              const firstOfId = boxes.findIndex((b) => b.id === box.id) === i;
              return (
                <span
                  key={`${box.id}-${i}`}
                  id={firstOfId ? `source-hit-${box.id}` : undefined}
                  data-verify-quote={box.id}
                  title={box.title}
                  className={`absolute rounded-sm border-b-2 ${active ? "border-amber-500 bg-amber-400/40 shadow-sm" : "border-amber-400 bg-amber-400/20"}`}
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.width}%`,
                    height: `${box.height}%`,
                    mixBlendMode: "multiply",
                  }}
                />
              );
            })}
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
  anchors: { id: string; citation: SourceCitation; label?: string }[];
  activeId?: string | null;
  onSelectAnchor?: (id: string) => void;
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
