import * as pdfjsLib from "pdfjs-dist";

const version = pdfjsLib.version || "6.3.289";
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

export { pdfjsLib };

export function pdfBytesFromBase64(raw: string): Uint8Array {
  const b64 = raw.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!b64) throw new Error("Missing PDF base64 payload.");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function pdfBlobFromBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}
