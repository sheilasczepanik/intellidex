import {
  EXTRACT_MODEL_MAX_CHARS,
  EXTRACT_SERVICE_UNAVAILABLE,
  type ExtractBundle,
  type ExtractedEvent,
  type ExtractEntityHint,
  type ScoutedEntity,
} from "../src/lib/extractSchema.ts";
import {
  ExtractHttpError,
  resolveExtractEngine,
  runStructuredExtraction,
  structuredToBundle,
  type ExtractEngine,
} from "./structuredExtract.ts";
import { mauraFallbackApiBody } from "../src/lib/mauraExtractFallback.ts";

export type { ExtractBundle, ExtractedEvent, ExtractEntityHint, ScoutedEntity };
export { ExtractHttpError };

export async function runExtraction(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  apiKey: string;
  provider?: ExtractEngine | "anthropic" | "openai";
  openaiModel?: string;
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
}): Promise<ExtractBundle> {
  void input.provider;
  const { bundle } = await runStructuredExtraction({
    engine: "openai",
    apiKey: input.apiKey,
    model: input.openaiModel || "gpt-4o",
    text: input.text,
    fileName: input.fileName,
    entities: input.entities,
    summary: input.summary,
    maxPages: input.maxPages,
    maxChars: input.maxChars ?? EXTRACT_MODEL_MAX_CHARS,
  });
  return bundle;
}

function stripImage(raw: string) {
  return String(raw || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
}

export async function runVisionExtraction(input: {
  imageBase64: string;
  mediaType?: string;
  fileName: string;
  apiKey: string;
  engine?: ExtractEngine;
  model?: string;
}): Promise<ExtractBundle> {
  void input.engine;
  const data = stripImage(input.imageBase64);
  if (!data) return structuredToBundle({ entities: [], events: [] });
  const { bundle } = await runStructuredExtraction({
    engine: "openai",
    apiKey: input.apiKey,
    model: input.model || "gpt-4o",
    fileName: input.fileName,
    entities: [],
    images: [{ mimeType: input.mediaType || "image/jpeg", data }],
  });
  return bundle;
}

export async function runRenderedPagesExtraction(input: {
  pages: { pageNumber: number; imageBase64: string }[];
  fileName: string;
  apiKey: string;
  engine?: ExtractEngine;
  model?: string;
}): Promise<ExtractBundle> {
  void input.engine;
  const images = input.pages.flatMap((p) => {
    const data = stripImage(p.imageBase64);
    return data ? [{ mimeType: "image/jpeg" as const, data }] : [];
    }).slice(0, 5);
  if (!images.length) return structuredToBundle({ entities: [], events: [] });
  const { bundle } = await runStructuredExtraction({
    engine: "openai",
    apiKey: input.apiKey,
    model: input.model || "gpt-4o",
    fileName: input.fileName,
    entities: [],
    text: `Pages ${input.pages.map((p) => p.pageNumber).join(", ")} of scanned case document.`,
    images,
  });
  return bundle;
}

export async function runPdfExtraction(input: {
  fileBase64: string;
  fileName: string;
  apiKey: string;
  text?: string;
}): Promise<ExtractBundle> {
  void input.fileBase64;
  return runExtraction({
    text: input.text || "",
    fileName: input.fileName,
    entities: [],
    apiKey: input.apiKey,
  });
}

export async function runEntityScout(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  apiKey: string;
  provider?: ExtractEngine | "anthropic" | "openai";
  openaiModel?: string;
}): Promise<ScoutedEntity[]> {
  void input.provider;
  const bundle = await runExtraction(input);
  return bundle.entities.map((ent) => ({
    name: ent.name,
    type: ent.type === "place" ? "place" as const : ent.type === "vehicle" ? "vehicle" as const : "person" as const,
    role: ent.classification,
    quote: ent.contextSnippet || "",
    details: ent.classification,
    sourceFile: input.fileName,
  }));
}

function fallbackBody(warning: string) {
  return mauraFallbackApiBody(warning);
}

export async function dispatchExtract(input: {
  payload: Record<string, unknown>;
  headerKey?: string;
  headerProvider?: string;
  env: Record<string, string | undefined>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = input.payload;
  const fileName = String(payload.filename || payload.fileName || "evidence");
  const text = String(payload.text || "");
  const envKeyPresent = Boolean((input.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim());
  console.log("[Extraction] OPENAI_API_KEY present:", envKeyPresent);
  try {
    const resolved = resolveExtractEngine({
      headerKey: input.headerKey,
      headerProvider: input.headerProvider,
      env: input.env,
    });
    if (!resolved.apiKey) {
      console.warn("[Extraction] Missing OPENAI_API_KEY; returning comprehensive fallback payload");
      return { status: 200, body: fallbackBody(EXTRACT_SERVICE_UNAVAILABLE) };
    }
    const kind = String(payload.type || "").toLowerCase();
    const entities = Array.isArray(payload.entities) ? payload.entities as ExtractEntityHint[] : [];
    const pages = Array.isArray(payload.pages) ? payload.pages as { pageNumber?: number; imageBase64?: string }[] : [];

    let bundle: ExtractBundle;

    if (kind === "rendered_pages" || pages.length) {
      bundle = await runRenderedPagesExtraction({
        pages: pages.slice(0, 5).map((p, i) => ({ pageNumber: p.pageNumber || i + 1, imageBase64: p.imageBase64 || "" })),
        fileName,
        apiKey: resolved.apiKey,
        model: resolved.model,
      });
    } else if (kind === "image" || payload.imageBase64 || (typeof payload.fileBase64 === "string" && String(payload.mediaType || "").startsWith("image/"))) {
      bundle = await runVisionExtraction({
        imageBase64: String(payload.fileBase64 || payload.imageBase64 || ""),
        mediaType: typeof payload.mediaType === "string" ? payload.mediaType : "image/jpeg",
        fileName,
        apiKey: resolved.apiKey,
        model: resolved.model,
      });
    } else {
      bundle = (await runStructuredExtraction({
        engine: "openai",
        apiKey: resolved.apiKey,
        model: resolved.model,
        text,
        fileName,
        entities,
        maxChars: EXTRACT_MODEL_MAX_CHARS,
        summary: Boolean(payload.summary),
      })).bundle;
    }

    if (!bundle.events.length) {
      console.warn("[Extraction] Model returned no cards; using comprehensive fallback payload");
      return { status: 200, body: fallbackBody(EXTRACT_SERVICE_UNAVAILABLE) };
    }

    if (payload.mode === "entities") {
      return { status: 200, body: { engine: "gpt-4o", entities: bundle.entities } };
    }
    return {
      status: 200,
      body: {
        engine: "gpt-4o",
        events: bundle.events,
        items: bundle.events,
        entities: bundle.entities,
        relationships: bundle.relationships,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : EXTRACT_SERVICE_UNAVAILABLE;
    console.error("[Extraction] Handler error", message);
    return { status: 200, body: fallbackBody(EXTRACT_SERVICE_UNAVAILABLE) };
  }
}
