import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { pdfBytesFromBase64 } from "./pdfjsSetup";

export type RenderedPdfPage = {
  pageNumber: number;
  imageBase64: string;
};

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return canvas.toDataURL("image/jpeg", quality);
}

export async function renderPdfPagesToJpeg(
  fileBase64: string,
  opts?: {
    maxPages?: number;
    scale?: number;
    quality?: number;
    onProgress?: (current: number, total: number) => void;
  },
): Promise<{ pages: RenderedPdfPage[]; pageCount: number }> {
  if (typeof document === "undefined") {
    throw new Error("PDF page rendering must run in the browser.");
  }
  const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 3, 5));
  const quality = opts?.quality ?? 0.8;
  const baseScale = opts?.scale ?? 1.5;
  let pdf: PDFDocumentProxy | null = null;
  try {
    pdf = await getDocument({ data: pdfBytesFromBase64(fileBase64) }).promise;
    const total = Math.min(pdf.numPages, maxPages);
    const pages: RenderedPdfPage[] = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create a canvas context to render PDF pages.");

    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      opts?.onProgress?.(pageNumber, total);
      const page = await pdf.getPage(pageNumber);
      let viewport = page.getViewport({ scale: baseScale });
      const maxEdge = 1600;
      const longest = Math.max(viewport.width, viewport.height);
      if (longest > maxEdge) {
        viewport = page.getViewport({ scale: baseScale * (maxEdge / longest) });
      }
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      let imageBase64 = canvasToJpeg(canvas, quality);
      if (imageBase64.length > 350_000) {
        imageBase64 = canvasToJpeg(canvas, 0.65);
      }
      pages.push({ pageNumber, imageBase64 });
    }
    return { pages, pageCount: pdf.numPages };
  } finally {
    await pdf?.cleanup();
  }
}

function itemStr(item: unknown) {
  if (item && typeof item === "object" && "str" in item) return String((item as { str: string }).str || "");
  return "";
}

/** Pull selectable text from every page so long PDFs can be chunked for Claude. */
export async function extractPdfText(
  fileBase64: string,
  opts?: { onProgress?: (current: number, total: number) => void },
): Promise<{ text: string; pageCount: number }> {
  let pdf: PDFDocumentProxy | null = null;
  try {
    pdf = await getDocument({ data: pdfBytesFromBase64(fileBase64) }).promise;
    const parts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      opts?.onProgress?.(pageNumber, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const line = content.items.map(itemStr).join(" ").replace(/\s+/g, " ").trim();
      parts.push(`--- Page ${pageNumber} ---\n${line}`);
    }
    return { text: parts.join("\n\n").trim(), pageCount: pdf.numPages };
  } finally {
    await pdf?.cleanup();
  }
}
