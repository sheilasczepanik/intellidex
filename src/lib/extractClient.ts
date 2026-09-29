import { getLocalApiKey, getLocalProvider } from "./settings";
import type { ExtractedEvent, ExtractBundle, ExtractEntityHint, ScoutedEntity } from "./extractSchema";
import { parseExtractGraph, sanitizeExtractText } from "./extractSchema";

export type { ExtractedEvent, ExtractEntityHint, ScoutedEntity };

const EXTRACT_TIMEOUT_MS = 180_000;

function clipBody(text: string, max = 800) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function apiErrorMessage(json: Record<string, unknown>, status: number, rawText = "") {
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
  return body || `Extract failed (${status})`;
}

async function postExtract<T>(body: object, pick: (raw: Record<string, unknown>) => T): Promise<T> {
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
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: res.statusText })) as { error?: unknown; raw?: unknown };
      const message = typeof errorData.error === "string" && errorData.error.trim()
        ? errorData.error
        : apiErrorMessage(errorData as Record<string, unknown>, res.status, String(errorData.error ?? res.statusText ?? ""));
      const raw = typeof errorData.raw === "string" ? clipBody(errorData.raw, 500) : "";
      throw new Error(raw && !message.includes(raw) ? `${message} | ${raw}` : message);
    }
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    console.log("[Extraction] Raw API response status:", res.status);
    return pick(json);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Timed out after 180s waiting for Claude. Try Retry (First 3 Pages) or Extract Summary.");
    }
    if (err instanceof TypeError) {
      throw new Error("Network dropped while contacting the extract API. Retry when you are online.");
    }
    throw err instanceof Error ? err : new Error("Extraction failed.");
  } finally {
    window.clearTimeout(timer);
  }
}

function pickEvents(body: Record<string, unknown>): ExtractedEvent[] {
  if (Array.isArray(body.items) && body.items.length) return body.items as ExtractedEvent[];
  if (Array.isArray(body.events)) return body.events as ExtractedEvent[];
  return [];
}

function pickBundle(body: Record<string, unknown>): ExtractBundle {
  const events = pickEvents(body);
  const graph = parseExtractGraph(body);
  return { events, entities: graph.entities, relationships: graph.relationships };
}

export async function extractEventsFromText(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
}): Promise<ExtractBundle> {
  const text = sanitizeExtractText(input.text, Math.min(input.maxChars ?? 10_000, 10_000));
  console.log("[Extraction] Ingested text length:", text.length);
  const bundle = await postExtract({ type: "text", ...input, text, maxChars: 10_000 }, pickBundle);
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
    pages: input.pages,
    entities: input.entities,
  }, pickBundle);
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
  }, pickBundle);
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
  }, pickBundle);
  console.log("[Extraction] Vision items count:", bundle.events.length);
  return bundle;
}

export async function scoutEntitiesFromText(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
}): Promise<ScoutedEntity[]> {
  return postExtract({ ...input, text: sanitizeExtractText(input.text), mode: "entities" }, (body) => (
    Array.isArray(body.entities) ? body.entities as ScoutedEntity[] : []
  ));
}
