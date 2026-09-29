export async function calculateSHA256(fileOrBuffer: File | ArrayBuffer): Promise<string> {
  const buffer = fileOrBuffer instanceof File ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function calculateSHA256FromText(text: string): Promise<string> {
  return calculateSHA256(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

export function formatSha256Badge(hex: string) {
  const h = hex.replace(/\s+/g, "").toLowerCase();
  if (h.length < 16) return h ? `SHA-256: ${h}` : "";
  return `SHA-256: ${h.slice(0, 8)}…${h.slice(-6)}`;
}

function decodeDataUrl(data: string): ArrayBuffer {
  const b64 = data.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function calculateSHA256FromDataUrl(dataUrl: string): Promise<string> {
  return calculateSHA256(decodeDataUrl(dataUrl));
}

export async function hashStoredEvidenceBytes(input: {
  fileBase64?: string;
  imageBase64?: string;
  rawText?: string;
}): Promise<string> {
  if (input.fileBase64) return calculateSHA256FromDataUrl(input.fileBase64);
  if (input.imageBase64) return calculateSHA256FromDataUrl(input.imageBase64);
  return calculateSHA256FromText(input.rawText ?? "");
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function safeExportSlug(title: string) {
  const slug = title.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72);
  return slug || "Case";
}

export function exportDateStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
