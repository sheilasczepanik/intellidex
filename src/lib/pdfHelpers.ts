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
    pageNumbers?: number[];
    onProgress?: (current: number, total: number) => void;
  },
): Promise<{ pages: RenderedPdfPage[]; pageCount: number }> {
  if (typeof document === "undefined") {
    throw new Error("PDF page rendering must run in the browser.");
  }
  const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 1, 5));
  const quality = opts?.quality ?? 0.8;
  const baseScale = opts?.scale ?? 1.5;
  let pdf: PDFDocumentProxy | null = null;
  try {
    pdf = await getDocument({ data: pdfBytesFromBase64(fileBase64) }).promise;
    const requested = (opts?.pageNumbers ?? [])
      .map((n) => Math.floor(n))
      .filter((n) => n >= 1 && n <= pdf!.numPages);
    const pageList = (requested.length ? requested : [1]).slice(0, maxPages);
    const pages: RenderedPdfPage[] = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create a canvas context to render PDF pages.");

    for (let i = 0; i < pageList.length; i += 1) {
      const pageNumber = pageList[i]!;
      opts?.onProgress?.(i + 1, pageList.length);
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

export { extractPdfText, ocrImageSource, documentText } from "./pdfParser";
