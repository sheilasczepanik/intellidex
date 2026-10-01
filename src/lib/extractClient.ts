import { getLocalApiKey, getLocalProvider } from "./settings";
import type { ExtractedEvent, ExtractBundle, ExtractEntityHint, ScoutedEntity } from "./extractSchema";
import {
  EXTRACT_CORE_PAGES,
  EXTRACT_MODEL_MAX_CHARS,
  EXTRACT_SERVICE_UNAVAILABLE,
  coerceExtractBundle,
  mergeExtractBundles,
  sanitizeExtractText,
  windowSourceText,
} from "./extractSchema";
import { regexExtractFromText, sampleExtractedCards } from "./regexExtract";

export type { ExtractedEvent, ExtractEntityHint, ScoutedEntity };

const EXTRACT_TIMEOUT_MS = 180_000;

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

function bundleFromResponse(json: Record<string, unknown>, fallbackText: string, fileName: string): ExtractBundle {
  let bundle = coerceExtractBundle(json);
  const failed = json.engine === "fallback" || Boolean(json.warning);
  if (!bundle.events.length && !bundle.entities.length) {
    bundle = mergeExtractBundles([bundle, regexExtractFromText(fallbackText || fileName, fileName)]);
  }
  if (failed && !bundle.events.length) {
    bundle = mergeExtractBundles([bundle, sampleExtractedCards(fileName)]);
  }
  return bundle;
}

async function postExtract(body: object, fallbackText: string, fileName: string): Promise<ExtractBundle> {
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
      const warning = apiErrorMessage(json, res.status, rawText);
      console.warn("[Extraction]", warning);
      return { ...bundle, warning: EXTRACT_SERVICE_UNAVAILABLE };
    }
    if (typeof json.warning === "string" && json.warning.trim()) {
      console.warn("[Extraction]", json.warning);
      return { ...bundle, warning: EXTRACT_SERVICE_UNAVAILABLE };
    }
    if (json.engine === "fallback") {
      return { ...bundle, warning: EXTRACT_SERVICE_UNAVAILABLE };
    }
    return bundle;
  } catch {
    const fallback = mergeExtractBundles([
      regexExtractFromText(fallbackText || fileName, fileName),
      sampleExtractedCards(fileName),
    ]);
    return { ...fallback, warning: EXTRACT_SERVICE_UNAVAILABLE };
  } finally {
    window.clearTimeout(timer);
  }
}

async function extractOneTextChunk(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
}): Promise<ExtractBundle> {
  const cap = Math.min(input.maxChars ?? EXTRACT_MODEL_MAX_CHARS, EXTRACT_MODEL_MAX_CHARS);
  const text = windowSourceText(sanitizeExtractText(input.text, 250_000), {
    maxPages: input.maxPages ?? EXTRACT_CORE_PAGES,
    maxChars: cap,
  });
  return postExtract({ type: "text", ...input, text, maxChars: cap }, text, input.fileName);
}

export async function extractEventsFromText(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
}): Promise<ExtractBundle> {
  console.log("[Extraction] Ingested text length:", input.text.length);
  let bundle = await extractOneTextChunk({ ...input, maxChars: EXTRACT_MODEL_MAX_CHARS });
  if (!bundle.events.length && !bundle.entities.length) {
    bundle = mergeExtractBundles([bundle, regexExtractFromText(input.text, input.fileName)]);
  }
  console.log("[Extraction] Parsed items count:", bundle.events.length);
  return bundle;
}

export async function extractEventsFromRenderedPages(input: {
  fileName: string;
  pages: { pageNumber: number; imageBase64: string }[];
  entities: ExtractEntityHint[];
}): Promise<ExtractBundle> {
  const bundle = await postExtract({
    type: "rendered_pages",
    filename: input.fileName,
    fileName: input.fileName,
    pages: input.pages.slice(0, EXTRACT_CORE_PAGES),
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
