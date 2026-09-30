import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import { pdfBytesFromBase64 } from "./pdfjsSetup";
import { realWordCount } from "./textClarity";

export type PdfParseResult = {
  text: string;
  pageCount: number;
  ocrPages: number;
  pageTexts: { pageNumber: number; text: string; ocr: boolean }[];
};

function itemStr(item: unknown) {
  if (item && typeof item === "object" && "str" in item) return String((item as { str: string }).str || "");
  return "";
}

function reconstructPageText(items: unknown[]) {
  const rows: { y: number; chunks: { x: number; str: string; eol?: boolean }[] }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw) || !("transform" in raw)) continue;
    const item = raw as { str: string; transform: number[]; hasEOL?: boolean };
    const str = item.str;
    if (!str && !item.hasEOL) continue;
    const x = item.transform[4] ?? 0;
    const y = Math.round((item.transform[5] ?? 0) * 2) / 2;
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) {
      row = { y, chunks: [] };
      rows.push(row);
    }
    row.chunks.push({ x, str, eol: item.hasEOL });
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((row) =>
    row.chunks
      .sort((a, b) => a.x - b.x)
      .map((c) => c.str)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim(),
  ).filter(Boolean);
  return stitchHyphenatedLines(lines);
}

function stitchHyphenatedLines(lines: string[]) {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && /[A-Za-z0-9]-$/.test(prev) && /^[a-z0-9]/.test(line)) {
      out[out.length - 1] = `${prev.slice(0, -1)}${line}`;
      continue;
    }
    if (prev && !/[.!?:;]$/.test(prev) && /^[a-z]/.test(line) && prev.length < 96) {
      out[out.length - 1] = `${prev} ${line}`;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function normalizeExtractedText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function pageLooksEmpty(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 24) return true;
  return realWordCount(text) < 12;
}

async function renderPageCanvas(page: PDFPageProxy, scale = 1.45) {
  if (typeof document === "undefined") throw new Error("OCR must run in the browser.");
  let viewport = page.getViewport({ scale });
  const maxEdge = 1800;
  const longest = Math.max(viewport.width, viewport.height);
  if (longest > maxEdge) viewport = page.getViewport({ scale: scale * (maxEdge / longest) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create a canvas for OCR.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

async function ocrCanvas(canvas: HTMLCanvasElement, worker?: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>) {
  if (worker) {
    const { data } = await worker.recognize(canvas);
    return normalizeExtractedText(data.text || "");
  }
  const { createWorker } = await import("tesseract.js");
  const created = await createWorker("eng");
  try {
    const { data } = await created.recognize(canvas);
    return normalizeExtractedText(data.text || "");
  } finally {
    await created.terminate();
  }
}

export async function ocrImageSource(src: string) {
  if (typeof document === "undefined") return "";
  const img = new Image();
  img.src = src;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not load image for OCR."));
  });
  const canvas = document.createElement("canvas");
  const maxEdge = 1800;
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    return await ocrCanvas(canvas);
  } catch (err) {
    console.error("[OCR] image recognize failed", err);
    return "";
  }
}

/** Sequential full-document parse: embedded text layer, then Tesseract on scanned pages. */
export async function extractPdfText(
  fileBase64: string,
  opts?: { onProgress?: (current: number, total: number, phase: "text" | "ocr") => void },
): Promise<PdfParseResult> {
  let pdf: PDFDocumentProxy | null = null;
  try {
    pdf = await getDocument({ data: pdfBytesFromBase64(fileBase64) }).promise;
    const pageTexts: PdfParseResult["pageTexts"] = [];
    let ocrPages = 0;
    let ocrWorker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;
    try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      opts?.onProgress?.(pageNumber, pdf.numPages, "text");
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = reconstructPageText(content.items);
      let ocr = false;
      if (pageLooksEmpty(text)) {
        try {
          opts?.onProgress?.(pageNumber, pdf.numPages, "ocr");
          if (!ocrWorker) {
            const { createWorker } = await import("tesseract.js");
            ocrWorker = await createWorker("eng");
          }
          const canvas = await renderPageCanvas(page);
          const ocrText = await ocrCanvas(canvas, ocrWorker);
          if (realWordCount(ocrText) > realWordCount(text)) {
            text = ocrText;
            ocr = true;
            ocrPages += 1;
          }
        } catch (err) {
          console.error(`[OCR] page ${pageNumber} failed`, err);
        }
      }
      pageTexts.push({ pageNumber, text, ocr });
    }
    } finally {
      await ocrWorker?.terminate();
    }
    const joined = pageTexts
      .map((p) => (p.text.trim() ? `--- Page ${p.pageNumber} ---\n${p.text.trim()}` : `--- Page ${p.pageNumber} ---\n`))
      .join("\n\n");
    return {
      text: normalizeExtractedText(joined),
      pageCount: pdf.numPages,
      ocrPages,
      pageTexts,
    };
  } finally {
    await pdf?.cleanup();
  }
}

export function documentText(ev: { fullText?: string; rawText?: string } | null | undefined) {
  return (ev?.fullText || ev?.rawText || "").trim();
}
