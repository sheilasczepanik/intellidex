import {
  ENTITY_SCOUT_SYSTEM,
  EXTRACT_SYSTEM,
  parseExtractBundle,
  parseScoutedEntities,
  sanitizeExtractText,
  userExtractPrompt,
  userScoutPrompt,
  type ExtractBundle,
  type ExtractedEvent,
  type ExtractEntityHint,
  type ScoutedEntity,
} from "../src/lib/extractSchema.ts";
import { MODEL_NAME, postAnthropicMessages } from "./anthropicModels.ts";

export type { ExtractBundle, ExtractedEvent, ExtractEntityHint, ScoutedEntity };

export class ExtractHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ExtractHttpError";
    this.status = status;
  }
}

export async function runExtraction(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  apiKey: string;
  provider: "anthropic" | "openai";
  anthropicModel?: string;
  openaiModel?: string;
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
}): Promise<ExtractBundle> {
  const prompt = userExtractPrompt(sanitizeExtractText(input.text, input.maxChars ?? 12_000), input.fileName, input.entities, {
    summary: input.summary,
    maxPages: input.maxPages,
    maxChars: input.maxChars ?? 12_000,
  });
  const raw = input.provider === "openai"
    ? await extractWithOpenAI(input.apiKey, prompt, EXTRACT_SYSTEM, input.openaiModel)
    : await extractWithAnthropic(input.apiKey, prompt, EXTRACT_SYSTEM, input.anthropicModel);
  console.log("[Extraction] Model output length:", raw.length);
  console.log("[Extraction] Model output first 300 characters:", raw.slice(0, 300));
  try {
    return parseExtractBundle(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid JSON";
    throw new ExtractHttpError(502, detail);
  }
}

const VISION_USER_TEXT = `Analyze this investigative evidence image in forensic detail. Extract observable facts into structured entities.
Identify:
1. Visual scene description and environment setting.
2. Legible text, signs, license plates, documents, or labels visible in the image.
3. People, clothing, distinctive markings, or physical features.
4. Vehicles (make, model, color, distinguishing features).
5. Physical items / exhibits / weapons / objects of interest.
6. Estimated time of day, lighting, or timestamp indicators.

For every item include exactQuote, pageNumber 1, and optional boundingBox as percentages 0-100 {x,y,width,height}.

Output STRICT JSON ONLY:
{ "items": [{ "type": "event", "category": "evidence"|"person"|"location"|"vehicle"|"time", "title": string, "entityName": string, "timestamp": string|null, "rawQuote": string, "exactQuote": string, "pageNumber": 1, "boundingBox": {"x":number,"y":number,"width":number,"height":number}|null, "confidence": number, "details": string }] }`;

export async function runVisionExtraction(input: {
  imageBase64: string;
  mediaType?: string;
  fileName: string;
  apiKey: string;
  anthropicModel?: string;
}): Promise<ExtractBundle> {
  const data = input.imageBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
  if (!data) throw new ExtractHttpError(400, "Image payload is empty.");
  const raw = await extractWithAnthropicContent(input.apiKey, EXTRACT_SYSTEM, [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: input.mediaType || "image/jpeg",
        data,
      },
    },
    { type: "text", text: VISION_USER_TEXT },
  ], input.anthropicModel || MODEL_NAME, 3000);
  try {
    return parseExtractBundle(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid JSON";
    throw new ExtractHttpError(502, detail);
  }
}

const PDF_USER_TEXT = `Visually read this document (running OCR as needed). Extract people, locations, vehicles, timestamps, and exhibits into structured items. For every item include pageNumber (1-indexed), exactQuote (verbatim), and optional boundingBox as percentages 0-100 {x,y,width,height}. Return STRICT JSON ONLY: { "items": [{ "category": "person"|"location"|"vehicle"|"time"|"evidence", "title": string, "entityName": string, "timestamp": string|null, "rawQuote": string, "exactQuote": string, "pageNumber": number, "boundingBox": {"x":number,"y":number,"width":number,"height":number}|null, "confidence": number, "details": string }] }`;

export async function runRenderedPagesExtraction(input: {
  pages: { pageNumber: number; imageBase64: string }[];
  fileName: string;
  apiKey: string;
  anthropicModel?: string;
}): Promise<ExtractBundle> {
  if (!input.pages.length) throw new ExtractHttpError(400, "rendered_pages payload has no page images.");
  const content: Record<string, unknown>[] = [];
  for (const p of input.pages) {
    const data = String(p.imageBase64 || "").replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
    if (!data) continue;
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data,
      },
    });
  }
  content.push({
    type: "text",
    text: `Visually read these scanned case document pages. Extract all observable people, locations, vehicles, timestamps, and physical evidence into structured entities.
Respond with STRICT JSON ONLY matching the system schema (items, entities, relationships). Each item must include pageNumber for the page it was read from.`,
  });
  if (content.length < 2) throw new ExtractHttpError(400, "rendered_pages payload has no page images.");
  const raw = await extractWithAnthropicContent(
    input.apiKey,
    EXTRACT_SYSTEM,
    content,
    input.anthropicModel || MODEL_NAME,
    3000,
  );
  try {
    return parseExtractBundle(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid JSON";
    throw new ExtractHttpError(502, detail);
  }
}

export async function runPdfExtraction(input: {
  fileBase64: string;
  fileName: string;
  apiKey: string;
  anthropicModel?: string;
}): Promise<ExtractBundle> {
  const data = input.fileBase64.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
  if (!data) throw new ExtractHttpError(400, "PDF payload is empty.");
  const raw = await extractWithAnthropicContent(
    input.apiKey,
    undefined,
    [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data,
        },
      },
      { type: "text", text: PDF_USER_TEXT },
    ],
    input.anthropicModel || MODEL_NAME,
    3000,
    { "anthropic-beta": "pdfs-2024-09-25" },
  );
  try {
    return parseExtractBundle(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Invalid JSON";
    throw new ExtractHttpError(502, detail);
  }
}

export async function runEntityScout(input: {
  text: string;
  fileName: string;
  entities: ExtractEntityHint[];
  apiKey: string;
  provider: "anthropic" | "openai";
  anthropicModel?: string;
  openaiModel?: string;
}): Promise<ScoutedEntity[]> {
  const prompt = userScoutPrompt(input.text, input.fileName, input.entities);
  if (input.provider === "openai") {
    return extractWithOpenAI(input.apiKey, prompt, ENTITY_SCOUT_SYSTEM, input.openaiModel).then(parseScoutedEntities);
  }
  return extractWithAnthropic(input.apiKey, prompt, ENTITY_SCOUT_SYSTEM, input.anthropicModel).then(parseScoutedEntities);
}

async function extractWithAnthropicContent(
  apiKey: string,
  system: string | undefined,
  content: unknown,
  model: string,
  maxTokens: number,
  extraHeaders?: Record<string, string>,
): Promise<string> {
  try {
    const raw = await postAnthropicMessages({
      apiKey,
      system,
      user: content as string | Array<Record<string, unknown>>,
      maxTokens,
      extraHeaders,
      preferredModel: model || MODEL_NAME,
    });
    const errorData = JSON.parse(raw || "{}") as { content?: { type?: string; text?: string }[] };
    const text = Array.isArray(errorData.content)
      ? errorData.content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n")
      : "";
    const fromFirst = errorData.content?.[0]?.text ?? "";
    const combined = (text || fromFirst).trim();
    if (!combined) throw new ExtractHttpError(502, "Anthropic returned an empty response.");
    return combined;
  } catch (err) {
    if (err instanceof ExtractHttpError) throw err;
    const status = err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
    throw new ExtractHttpError(status, err instanceof Error ? err.message : "Anthropic request failed.");
  }
}

async function extractWithAnthropic(apiKey: string, prompt: string, system: string, model?: string): Promise<string> {
  return extractWithAnthropicContent(
    apiKey,
    system,
    prompt,
    model || MODEL_NAME,
    system === ENTITY_SCOUT_SYSTEM ? 4000 : 8192,
  );
}

async function extractWithOpenAI(apiKey: string, prompt: string, system: string, model?: string): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });
  try {
    const msg = await client.chat.completions.create({
      model: model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      max_tokens: 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    return msg.choices[0]?.message?.content ?? "";
  } catch (err) {
    if (err instanceof ExtractHttpError) throw err;
    throw wrapProviderError("OpenAI", err);
  }
}

function wrapProviderError(vendor: string, err: unknown): ExtractHttpError {
  const rec = err && typeof err === "object"
    ? err as { status?: number; statusCode?: number; message?: string; error?: { message?: string; type?: string } }
    : {};
  const status = rec.status ?? rec.statusCode ?? 500;
  const detail = rec.error?.message || rec.error?.type || rec.message || (err instanceof Error ? err.message : "request failed");
  return new ExtractHttpError(status, `${vendor}: ${detail}`);
}
