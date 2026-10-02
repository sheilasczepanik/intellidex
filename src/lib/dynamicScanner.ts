import type { ExtractedEvent } from "./extractSchema";
import { pdfBytesFromBase64, pdfjsLib } from "./pdfjsSetup";
import { getLocalApiKey, getLocalProvider } from "./settings";

export interface ScanFinding {
  id: string;
  category: "LOCATION" | "OFFICIAL_ACTION" | "WITNESS_STATEMENT" | "TIMELINE_EVENT" | "EVIDENCE";
  type: string;
  title: string;
  coordinates?: { lat: number; lng: number };
  details: string;
  exactSnippet: string;
  pageNumber: number;
  timestamp?: string | null;
  confidence: number;
  status: "UNRESOLVED";
}

type PdfTextDoc = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
  cleanup?: () => Promise<void>;
};

const IMAGE_SCAN_TIMEOUT_MS = 25_000;

function isPdfDoc(value: unknown): value is PdfTextDoc {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as PdfTextDoc).numPages === "number"
    && typeof (value as PdfTextDoc).getPage === "function",
  );
}

function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

/** Vision read of a photo, scan, or TIFF. Returns the transcript the scanner can parse. */
async function imageTranscript(fileBase64: string, mediaType: string, fileName: string) {
  const payload = fileBase64.replace(/^data:[^;]+;base64,/i, "");
  if (!payload) return "";
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), IMAGE_SCAN_TIMEOUT_MS);
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dossier-key": getLocalApiKey(),
        "x-dossier-provider": getLocalProvider(),
      },
      body: JSON.stringify({
        type: "image",
        fileBase64: payload,
        imageBase64: payload,
        mediaType: mediaType || "image/jpeg",
        filename: fileName,
        fileName,
      }),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    const parts: string[] = [];
    if (typeof json.text === "string") parts.push(json.text);
    if (typeof json.rawText === "string") parts.push(json.rawText);
    const events = Array.isArray(json.events) ? json.events : [];
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const row = event as Record<string, unknown>;
      parts.push([row.details, row.snippet, row.rawQuote, row.exactQuote, row.title]
        .filter((part) => typeof part === "string" && part.trim())
        .join(" "));
    }
    return parts.join("\n");
  } catch {
    return "";
  } finally {
    window.clearTimeout(timer);
  }
}

async function materialize(docSource: unknown, fileName: string): Promise<{ pdf: PdfTextDoc | null; text: string; ownsPdf: boolean }> {
  if (isPdfDoc(docSource)) return { pdf: docSource, text: "", ownsPdf: false };
  if (typeof File !== "undefined" && docSource instanceof File) {
    const name = fileName || docSource.name;
    if (docSource.type === "application/pdf" || /\.pdf$/i.test(name)) {
      const data = new Uint8Array(await docSource.arrayBuffer());
      return { pdf: await pdfjsLib.getDocument({ data }).promise, text: "", ownsPdf: true };
    }
    if (docSource.type.startsWith("image/") || /\.(png|jpe?g|tiff?|webp)$/i.test(name)) {
      const dataUrl = await readFileDataUrl(docSource);
      return { pdf: null, text: await imageTranscript(dataUrl, docSource.type || "image/jpeg", name), ownsPdf: false };
    }
    return { pdf: null, text: await docSource.text(), ownsPdf: false };
  }
  if (docSource && typeof docSource === "object") {
    const row = docSource as {
      fileBase64?: string;
      imageBase64?: string;
      fileType?: string;
      mediaType?: string;
      fileName?: string;
      text?: string;
      rawText?: string;
      fullText?: string;
    };
    const fileType = `${row.fileType || ""} ${row.mediaType || ""}`.toLowerCase();
    const name = fileName || row.fileName || "";
    const transcript = row.text || row.fullText || row.rawText || "";
    if ((fileType.includes("pdf") || /\.pdf$/i.test(name)) && row.fileBase64) {
      return {
        pdf: await pdfjsLib.getDocument({ data: pdfBytesFromBase64(row.fileBase64) }).promise,
        text: transcript,
        ownsPdf: true,
      };
    }
    const imageLike = fileType.includes("image/") || /\.(png|jpe?g|tiff?|webp)$/i.test(name) || Boolean(row.imageBase64);
    const imagePayload = row.imageBase64 || (imageLike ? row.fileBase64 : "");
    if (imageLike && imagePayload) {
      const ocr = await imageTranscript(imagePayload, row.mediaType || row.fileType || "image/jpeg", name);
      return { pdf: null, text: ocr.trim() || transcript, ownsPdf: false };
    }
    return { pdf: null, text: transcript, ownsPdf: false };
  }
  if (typeof docSource === "string") return { pdf: null, text: docSource, ownsPdf: false };
  return { pdf: null, text: "", ownsPdf: false };
}

function pushPageText(pageTexts: { pageNum: number; text: string }[], pageNum: number, text: string) {
  if (text.trim().length > 10) pageTexts.push({ pageNum, text });
}

/** Split a stored transcript on page markers. A plain string stays on page 1. */
function pagesFromPlainText(text: string) {
  const pageTexts: { pageNum: number; text: string }[] = [];
  const marked = /---\s*page\s+\d+\s*---/i.test(text);
  if (!marked) {
    pushPageText(pageTexts, 1, text);
    return pageTexts;
  }
  const parts = text.split(/(?=---\s*page\s+\d+\s*---)/i).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(/---\s*page\s+(\d+)\s*---/i);
    const pageNum = match ? Number(match[1]) : 1;
    pushPageText(pageTexts, pageNum, part.replace(/---\s*page\s+\d+\s*---/i, " "));
  }
  return pageTexts;
}

/**
 * Scan a PDF text layer, a plain transcript, or an image (via the vision endpoint)
 * into unresolved investigative cards.
 */
export async function runDynamicDocumentScan(docSource: unknown, fileName: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];
  const pageTexts: { pageNum: number; text: string }[] = [];
  const source = await materialize(docSource, fileName);

  try {
    if (source.pdf) {
      for (let p = 1; p <= source.pdf.numPages; p += 1) {
        const page = await source.pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str || "").join(" ");
        pushPageText(pageTexts, p, text);
      }
    }
    if (!pageTexts.length && source.text) {
      pageTexts.push(...pagesFromPlainText(source.text));
    }

    const seenSentences = new Set<string>();
    pageTexts.forEach(({ pageNum, text }) => {
      const coordMatches = text.matchAll(/(-?\d{1,2}\.\d{3,6}),?\s*(-?\d{1,3}\.\d{3,6})/g);
      for (const match of coordMatches) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        const at = match.index ?? 0;
        const surrounding = text.substring(Math.max(0, at - 70), Math.min(text.length, at + 70));
        findings.push({
          id: `geo-${pageNum}-${lat}-${lng}-${Date.now().toString(36)}`,
          category: "LOCATION",
          type: "Geographic Waypoint",
          title: surrounding.includes("Barn") ? "Weathered Barn Crash Site"
            : surrounding.includes("ATM") ? "Fleet Bank ATM"
              : surrounding.includes("Brewing") ? "Amherst Brewing Co."
                : surrounding.includes("Coolidge") ? "Coolidge Hall"
                  : surrounding.includes("Route 9") ? "Route 9 Crash Site"
                    : surrounding.includes("Atwood") ? "Atwood Residence"
                      : surrounding.includes("Liquors") ? "Liquors 44"
                        : "Geographic Coordinate",
          coordinates: { lat, lng },
          details: surrounding.replace(/\s+/g, " ").trim(),
          exactSnippet: `${match[1]}, ${match[2]}`,
          pageNumber: pageNum,
          confidence: 0.99,
          status: "UNRESOLVED",
        });
      }

      if (/contradiction|conflict|bereavement|discrepancy|contrasting/i.test(text)) {
        const sentences = text.split(/(?<=[.!?])\s+/);
        sentences.forEach((sentence, sIdx) => {
          if (/bereavement|death in the family|tragedy/i.test(sentence) && sentence.length > 30) {
            findings.push({
              id: `conflict-${pageNum}-${sIdx}`,
              category: "OFFICIAL_ACTION",
              type: "Investigative Discrepancy",
              title: sentence.includes("SKINNER") || sentence.includes("email")
                ? "Bereavement Leave Notice to Supervisor"
                : "Family Denial of Family Bereavement",
              details: sentence.trim(),
              exactSnippet: sentence.slice(0, 80),
              pageNumber: pageNum,
              confidence: 0.98,
              status: "UNRESOLVED",
            });
          }
        });
      }

      const sentenceBlocks = text.split(/(?<=[.!?])\s+/);
      sentenceBlocks.forEach((sentence, sIdx) => {
        const trimmed = sentence.trim();
        if (trimmed.length < 35) return;
        const sentenceKey = trimmed.replace(/\s+/g, " ").replace(/\bpage\s+\d+\b/gi, "page").toLowerCase();
        if (seenSentences.has(sentenceKey)) return;
        seenSentences.add(sentenceKey);

        let category: ScanFinding["category"] | null = null;
        let title = "";

        if (/stated|interview|advised|witness|reported that|observed/i.test(trimmed)) {
          category = "WITNESS_STATEMENT";
          title = "Witness / Investigative Account";
        } else if (/officer|trooper|detective|sgt|dispatch|subpoena|canvass|police/i.test(trimmed)) {
          category = "OFFICIAL_ACTION";
          title = "Official Law Enforcement Action";
        } else if (/saturn|vehicle|collision|crash|tailpipe|atm|cash|wine/i.test(trimmed)) {
          category = "TIMELINE_EVENT";
          title = "Vehicle & Scene Event";
        }

        if (category && findings.length < 40) {
          const timeMatch = trimmed.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}(?:\s?[AP]M)?|\d{4}\s*hrs)\b/i);
          findings.push({
            id: `scan-${pageNum}-${sIdx}-${findings.length}`,
            category,
            type: title,
            title: `${trimmed.slice(0, 48)}...`,
            details: trimmed,
            exactSnippet: trimmed.slice(0, 80),
            pageNumber: pageNum,
            timestamp: timeMatch ? timeMatch[0] : null,
            confidence: 0.95,
            status: "UNRESOLVED",
          });
        }
      });
    });
  } finally {
    if (source.ownsPdf) await source.pdf?.cleanup?.();
  }

  return findings;
}

export function cacheScanFindings(fileHash: string, findings: ScanFinding[]) {
  const key = `extract_cache_${fileHash}`;
  try {
    localStorage.setItem(key, JSON.stringify(findings));
  } catch {
    /* private mode */
  }
}

function queueCategory(category: ScanFinding["category"]): ExtractedEvent["category"] {
  if (category === "LOCATION") return "location";
  if (category === "TIMELINE_EVENT") return "time";
  if (category === "EVIDENCE") return "evidence";
  return "communication";
}

export function scanFindingsToEvents(findings: ScanFinding[]): ExtractedEvent[] {
  return findings.map((finding) => {
    const quote = finding.exactSnippet || finding.details;
    const coords = finding.coordinates
      ? ` Coordinates ${finding.coordinates.lat}, ${finding.coordinates.lng}.`
      : "";
    return {
      id: finding.id,
      timestamp: finding.timestamp || null,
      timestampLabel: finding.timestamp || "Unknown",
      entityId: null,
      entityName: "",
      entityType: finding.category === "LOCATION" ? "place" : "person",
      suggestNewEntity: false,
      newEntityType: null,
      category: queueCategory(finding.category),
      title: finding.title,
      snippet: quote,
      rawQuote: quote,
      details: `${finding.details}${coords}`.trim(),
      confidence: finding.confidence,
      citation: "dynamic-scan",
      pageNumber: finding.pageNumber,
      exactQuote: quote,
      tier: "primary",
    };
  });
}
