export const LOW_CLARITY_BADGE =
  "Scanned PDF with low text clarity. Paste plain text into the narrative box for best extraction accuracy.";

export const UNREADABLE_SCAN_ALERT =
  "Scanned document text unreadable. Please paste clean narrative text.";

export type TextClarity = "ok" | "low";

export function realWordCount(text: string) {
  return (text.match(/\b[A-Za-z]{2,}\b/g) ?? []).length;
}

export function assessTextClarity(text: string, pageCount = 1): TextClarity {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return "low";
  const words = realWordCount(text);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
  const alnumRatio = alnum / compact.length;
  const letterRatio = letters / compact.length;
  const multiPageThin = pageCount >= 2 && words < 50;
  const noisy = alnumRatio < 0.58 || letterRatio < 0.48;
  return multiPageThin || noisy ? "low" : "ok";
}

/** Completely empty text layer only — sparse OCR and redactions still go to the model. */
export function isUnreadableScan(text: string) {
  const stripped = text.replace(/\n\n\[Initial pass:[\s\S]*$/, "").trim();
  return stripped.length === 0;
}

export function logExtractedText(rawText: string, source = "PDF") {
  console.log(`[Extraction] ${source} raw extracted text length:`, rawText.length);
  console.log(`[Extraction] First 300 characters:`, rawText.slice(0, 300));
}
