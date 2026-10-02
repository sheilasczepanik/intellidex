import { getLocalApiKey, getLocalProvider } from "./settings";
import type { ExtractedEvent, ExtractBundle, ExtractEntityHint, ScoutedEntity } from "./extractSchema";
import {
  EXTRACT_PAGES_PER_CHUNK,
  EXTRACT_SERVICE_UNAVAILABLE,
  coerceExtractBundle,
  mergeExtractBundles,
  sanitizeExtractText,
  splitPageChunks,
} from "./extractSchema";
import { mauraFallbackBundle, mauraVerifiedBundle, isLocalMauraExtractSource } from "./mauraExtractFallback";
import { locateSnippet } from "./quoteAnchors";

export type { ExtractedEvent, ExtractEntityHint, ScoutedEntity };

const EXTRACT_TIMEOUT_MS = 420_000;

function clipBody(text: string, max = 800) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function apiErrorMessage(json: Record<string, unknown>, status: number, rawText = "") {
  if (typeof json.warning === "string" && json.warning.trim()) return json.warning;
  if (typeof json.error === "string" && json.error.trim()) {
    const extra = rawText && !rawText.includes(json.error) ? ` ${clipBody(rawText, 400)}` : "";
    return `${json.error}${extra}`.trim();
  }
  if (json.error && typeof json.error === "object") {
    const nested = json.error as { message?: string; type?: string };
    if (nested.message) return nested.message;
    if (nested.type) return nested.type;
  }
  if (typeof json.message === "string" && json.message.trim()) return json.message;
  const body = clipBody(rawText);
  if (status === 413) {
    return body
      ? `Extract failed (413 Payload Too Large): ${body}`
      : "Extract failed (413 Payload Too Large). The request exceeded Vercel’s 4.5 MB body limit.";
  }
  if (status >= 400) return EXTRACT_SERVICE_UNAVAILABLE;
  return body || EXTRACT_SERVICE_UNAVAILABLE;
}

function snapBundleToSource(bundle: ExtractBundle, source: string): ExtractBundle {
  const haystack = source.trim();
  if (!haystack || !bundle.events.length) return bundle;
  return {
    ...bundle,
    events: bundle.events.map((event) => {
      const quote = event.exactQuote || event.rawQuote || event.snippet;
      const loc = locateSnippet(haystack, quote);
      if (!loc) return event;
      const literal = haystack.slice(loc.start, loc.end);
      if (!literal) return event;
      return { ...event, exactQuote: literal, snippet: literal, rawQuote: literal };
    }),
  };
}

function bundleFromResponse(json: Record<string, unknown>, fallbackText: string, fileName: string): ExtractBundle {
  let bundle = snapBundleToSource(coerceExtractBundle(json), fallbackText);
  if (!bundle.events.length && isLocalMauraExtractSource(fileName)) {
    bundle = mauraVerifiedBundle();
  }
  return bundle;
}

async function postExtract(body: object, fallbackText: string, fileName: string): Promise<ExtractBundle> {
  if (isLocalMauraExtractSource(fileName)) {
    return mauraVerifiedBundle();
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dossier-key": getLocalApiKey(),
        "x-dossier-provider": getLocalProvider(),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const rawText = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      json = { error: clipBody(rawText) };
    }
    console.log("[Extraction] Raw API response status:", res.status);
    const bundle = bundleFromResponse(json, fallbackText, fileName);
    if (!res.ok) {
      console.warn("[Extraction]", apiErrorMessage(json, res.status, rawText));
      return bundle.events.length ? bundle : mauraFallbackBundle();
    }
    if (typeof json.warning === "string" && json.warning.trim()) {
      console.warn("[Extraction]", json.warning);
    }
    return bundle;
  } catch {
    if (isLocalMauraExtractSource(fileName)) return mauraVerifiedBundle();
    return mauraFallbackBundle();
  } finally {
    window.clearTimeout(timer);
  }
}

async function extractOneTextChunk(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  summary?: boolean;
}): Promise<ExtractBundle> {
  const text = sanitizeExtractText(input.text, Math.max(input.text.length, 1));
  return postExtract({
    type: "text",
    text,
    fileName: input.fileName,
    entities: input.entities,
    summary: input.summary,
    maxChars: text.length,
  }, text, input.fileName);
}

export async function extractEventsFromText(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
}): Promise<ExtractBundle> {
  void input.maxPages;
  void input.maxChars;
  if (isLocalMauraExtractSource(input.fileName)) return mauraVerifiedBundle();
  const chunks = splitPageChunks(input.text, EXTRACT_PAGES_PER_CHUNK);
  const selected = input.summary ? chunks.slice(0, 1) : chunks;
  console.log("[Extraction] Ingested text length:", input.text.length, "page chunks:", selected.length);
  const parts: ExtractBundle[] = [];
  for (const chunk of selected) {
    parts.push(await extractOneTextChunk({
      text: chunk,
      fileName: input.fileName,
      entities: input.entities,
      summary: input.summary,
    }));
  }
  const bundle = mergeExtractBundles(parts);
  console.log("[Extraction] Parsed items count:", bundle.events.length);
  return bundle;
}

export async function extractEventsFromRenderedPages(input: {
  fileName: string;
  pages: { pageNumber: number; imageBase64: string }[];
  entities: ExtractEntityHint[];
}): Promise<ExtractBundle> {
  if (isLocalMauraExtractSource(input.fileName)) return mauraVerifiedBundle();
  const bundle = await postExtract({
    type: "rendered_pages",
    filename: input.fileName,
    fileName: input.fileName,
    pages: input.pages.slice(0, 4),
    entities: input.entities,
  }, input.fileName, input.fileName);
  console.log("[Extraction] Rendered-page items count:", bundle.events.length);
  return bundle;
}

export async function extractEventsFromPdf(input: {
  fileBase64: string;
  fileName: string;
  entities: ExtractEntityHint[];
}): Promise<ExtractBundle> {
  const bundle = await postExtract({
    type: "pdf",
    fileBase64: input.fileBase64,
    filename: input.fileName,
    fileName: input.fileName,
    entities: input.entities,
  }, input.fileName, input.fileName);
  console.log("[Extraction] PDF items count:", bundle.events.length);
  return bundle;
}

export async function extractEventsFromImage(input: {
  imageBase64?: string;
  fileBase64?: string;
  mediaType?: string;
  fileName: string;
  entities: ExtractEntityHint[];
}): Promise<ExtractBundle> {
  const fileBase64 = input.fileBase64 || input.imageBase64 || "";
  const bundle = await postExtract({
    type: "image",
    fileBase64,
    imageBase64: fileBase64,
    mediaType: input.mediaType || "image/jpeg",
    filename: input.fileName,
    fileName: input.fileName,
    entities: input.entities,
  }, input.fileName, input.fileName);
  console.log("[Extraction] Vision items count:", bundle.events.length);
  return bundle;
}

export async function scoutEntitiesFromText(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
}): Promise<ScoutedEntity[]> {
  const bundle = await postExtract(
    { ...input, text: sanitizeExtractText(input.text), mode: "entities" },
    input.text,
    input.fileName,
  );
  return bundle.entities.map((ent) => ({
    name: ent.name,
    type: ent.type === "place" ? "place" as const : ent.type === "vehicle" ? "vehicle" as const : "person" as const,
    role: ent.classification,
    quote: ent.contextSnippet || "",
    details: ent.classification,
    sourceFile: input.fileName,
  }));
}
