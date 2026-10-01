import OpenAI from "openai";
import { z } from "zod";
import {
  EXTRACT_MODEL_MAX_CHARS,
  EXTRACT_SERVICE_UNAVAILABLE,
  EXTRACT_SYSTEM,
  coerceExtractBundle,
  prioritizeLegalFacts,
  userExtractPrompt,
  type ExtractBundle,
  type ExtractEntityHint,
} from "../src/lib/extractSchema.ts";

export class ExtractHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ExtractHttpError";
    this.status = status;
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "sk-unconfigured" });

export const intelExtractCardSchema = z.object({
  type: z.enum(["person", "location", "timeline_event", "vehicle", "evidence"]),
  title: z.string(),
  category: z.string(),
  date: z.string().optional(),
  quote: z.string(),
  anchorText: z.string().optional(),
  confidence: z.number().optional(),
  details: z.string().optional(),
  role: z.string().optional(),
});

export const structuredEntitySchema = z.object({
  name: z.string(),
  category: z.enum(["person", "location", "vehicle", "phone", "exhibit"]),
  role: z.string(),
  context: z.string(),
});

export const structuredEventSchema = z.object({
  date: z.string(),
  time: z.string(),
  title: z.string(),
  summary: z.string(),
  sourceReference: z.string(),
});

export const structuredExtractSchema = z.object({
  entities: z.array(z.union([intelExtractCardSchema, structuredEntitySchema])).optional(),
  events: z.array(structuredEventSchema).optional(),
  subject: z.object({
    name: z.string().optional(),
    age: z.string().optional(),
    identifyingMarks: z.array(z.string()).optional(),
    clothingLastSeen: z.string().optional(),
    medicalVulnerabilities: z.array(z.string()).optional(),
  }).optional(),
  lks: z.object({
    date: z.string().optional(),
    time: z.string().optional(),
    location: z.string().optional(),
    circumstances: z.string().optional(),
  }).optional(),
  sightingsAndEvents: z.array(z.object({
    date: z.string().optional(),
    time: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    summary: z.string().optional(),
    tier: z.enum(["primary", "secondary"]).optional(),
  })).optional(),
  searchLocations: z.array(z.object({
    name: z.string(),
    type: z.enum(["last_seen", "item_recovered", "cell_ping", "search_grid"]).optional(),
    description: z.string().optional(),
  })).optional(),
  contacts: z.array(z.object({
    name: z.string(),
    role: z.string().optional(),
    relation: z.string().optional(),
  })).optional(),
}).passthrough();

export type StructuredExtract = z.infer<typeof structuredExtractSchema>;
export type ExtractEngine = "openai";

const EMPTY: Record<string, unknown> = {};

function openaiClient(apiKey?: string) {
  const key = (process.env.OPENAI_API_KEY || apiKey || "").trim();
  if (!key) {
    throw new ExtractHttpError(401, "Set OPENAI_API_KEY in .env.local (or paste an OpenAI key in Settings).");
  }
  if (process.env.OPENAI_API_KEY && key === process.env.OPENAI_API_KEY) return openai;
  return new OpenAI({ apiKey: key });
}

export function resolveExtractEngine(input: {
  headerKey?: string;
  headerProvider?: string;
  env: Record<string, string | undefined>;
}): { engine: ExtractEngine; apiKey: string; model: string } {
  void input.headerProvider;
  const header = (input.headerKey || "").trim();
  const envKey = (input.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const headerOpenAi = header.startsWith("sk-") && !header.startsWith("sk-ant-");
  const apiKey = envKey || (headerOpenAi ? header : "");
  return { engine: "openai", apiKey, model: input.env.OPENAI_MODEL?.trim() || "gpt-4o" };
}

export function structuredToBundle(parsed: unknown): ExtractBundle {
  return coerceExtractBundle((parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>);
}

function parseModelContent(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return parseModelContent(match[0]);
  }
  return EMPTY;
}

type MediaPart = { mimeType: string; data: string };

export async function runStructuredExtraction(input: {
  engine?: ExtractEngine;
  apiKey: string;
  model?: string;
  text?: string;
  fileName: string;
  entities: ExtractEntityHint[];
  summary?: boolean;
  maxPages?: number;
  maxChars?: number;
  images?: MediaPart[];
}): Promise<{ bundle: ExtractBundle; engine: string }> {
  void input.engine;
  const cap = Math.min(input.maxChars ?? EXTRACT_MODEL_MAX_CHARS, EXTRACT_MODEL_MAX_CHARS);
  const source = prioritizeLegalFacts(input.text || "Extract facts visible in the attached media.", cap);
  const prompt = userExtractPrompt(source, input.fileName, input.entities, {
    summary: input.summary,
    maxPages: input.maxPages,
    maxChars: cap,
  });
  const parsed = await extractWithGpt4o({
    apiKey: input.apiKey,
    model: input.model || "gpt-4o",
    prompt,
    images: input.images,
  });
  return { bundle: structuredToBundle(parsed), engine: "gpt-4o" };
}

async function extractWithGpt4o(input: {
  apiKey: string;
  model: string;
  prompt: string;
  images?: MediaPart[];
}): Promise<Record<string, unknown>> {
  const client = openaiClient(input.apiKey);
  const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: input.prompt },
    ...(input.images ?? []).map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
  ];
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: userContent },
      ],
    });
    return parseModelContent(completion.choices[0]?.message?.content);
  } catch (err) {
    if (err instanceof ExtractHttpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
    console.error("[Extraction] GPT-4o request failed:", message);
    if (status === 401 || status === 403 || /invalid api key|incorrect api key|authentication|unauthorized/i.test(message)) {
      throw new ExtractHttpError(401, EXTRACT_SERVICE_UNAVAILABLE);
    }
    throw new ExtractHttpError(status >= 400 ? status : 502, EXTRACT_SERVICE_UNAVAILABLE);
  }
}
