import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 60;

export const config = {
  maxDuration: 60,
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const MODELS_TO_TRY = [
  "claude-3-5-sonnet-20240620",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
  "claude-sonnet-5-5",
  "claude-sonnet-4-6",
];

const OUTPUT_BUDGET = `Extract the top 15 most salient chronological events, sightings, persons, and physical exhibits. Keep each 'details' string concise (under 30 words) to ensure the full JSON payload completes cleanly within token limits.`;

const EXTRACT_SYSTEM = `You are a criminal case analysis engine. Extract people, locations, vehicles, phones, digital identifiers, exhibits, timestamps, and directed relationships. ${OUTPUT_BUDGET} Respond with STRICT JSON ONLY: { "items": [{ "type": "event", "category": "person"|"location"|"vehicle"|"time"|"evidence", "title": string, "entityName": string, "timestamp": string|null, "rawQuote": string, "exactQuote": string, "pageNumber": number|null, "boundingBox": { "x": number, "y": number, "width": number, "height": number }|null, "confidence": number, "details": string }], "entities": [{ "name": string, "type": "person"|"vehicle"|"location"|"phone"|"digital"|"exhibit", "classification": string, "identifiers": string[] }], "relationships": [{ "sourceEntity": string, "targetEntity": string, "relationshipType": "registered_owner"|"operator_driver"|"passenger"|"residence"|"crime_scene"|"last_known_location"|"phone_subscriber"|"cell_tower_ping"|"associate_of", "label": string, "confidence": number }] }.`;

const SCOUT_SYSTEM = `You are doing fast entity reconnaissance. ${OUTPUT_BUDGET} Return STRICT JSON ONLY: { "entities": [{ "name": string, "type": "person"|"place"|"vehicle", "role": string, "quote": string, "details": string, "sourceFile": string }] }`;

const RENDERED_PAGES_USER_TEXT = `Analyze these scanned case document pages. Identify all people, locations, vehicles, timestamps, and evidence items.
${OUTPUT_BUDGET}
Output strictly a JSON object with this shape:
{
  "items": [
    {
      "category": "person" | "location" | "vehicle" | "time" | "evidence",
      "title": string,
      "entityName": string,
      "timestamp": string | null,
      "rawQuote": string,
      "confidence": number,
      "details": string,
      "pageNumber": number
    }
  ],
  "entities": [],
  "relationships": []
}`;

const VISION_USER_TEXT = `Analyze this case image or document scan. Extract observable people, vehicles, locations, evidence, and timestamps. ${OUTPUT_BUDGET} Return strictly JSON: { "items": [], "entities": [], "relationships": [] }`;

const PDF_USER_TEXT = `Visually read this document (OCR as needed). Extract people, locations, vehicles, timestamps, and evidence. ${OUTPUT_BUDGET} Return STRICT JSON ONLY: { "items": [], "entities": [], "relationships": [] }`;

function header(req: VercelRequest, name: string) {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? "" : "";
}

function errMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  return String(err || "Unhandled server error");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function stripDataUrl(raw: string, kind: "pdf" | "image") {
  const cleaned = String(raw || "").replace(/\s+/g, "");
  if (kind === "pdf") return cleaned.replace(/^data:application\/pdf;base64,/i, "");
  return cleaned.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function parseRequestBody(raw: unknown): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: false, error: "No request body provided." };
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "Malformed JSON body: expected an object." };
      }
      return { ok: true, body: parsed as Record<string, unknown> };
    } catch (e: unknown) {
      return { ok: false, error: `Malformed JSON body: ${errMessage(e)}` };
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return { ok: true, body: raw as Record<string, unknown> };
  return { ok: false, error: "Malformed JSON body: expected an object." };
}

function parseAndRepairJson(rawText: string) {
  // Strip code block fences
  const cleaned = String(rawText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const directMatch = cleaned.match(/\{[\s\S]*\}/);
    if (directMatch) {
      return JSON.parse(directMatch[0]);
    }
  } catch {
    // Truncated mid-stream; proceed to repair
  }

  for (const key of ['"items"', '"events"', '"entities"']) {
    const itemsStart = cleaned.indexOf(key);
    if (itemsStart === -1) continue;
    const arrayStart = cleaned.indexOf("[", itemsStart);
    if (arrayStart === -1) continue;
    const lastObjectEnd = cleaned.lastIndexOf("}");
    if (lastObjectEnd <= arrayStart) continue;
    const sliced = `${cleaned.slice(0, lastObjectEnd + 1)}]}`;
    try {
      const jsonMatch = sliced.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (repairErr) {
      console.error("Failed to parse repaired JSON slice", repairErr);
    }
  }

  throw Object.assign(
    new Error(`Unable to parse AI response. Raw output snippet: ${cleaned.slice(0, 200)}...`),
    { raw: rawText, status: 502 },
  );
}

function parseModelJson(rawText: string) {
  const obj = asRecord(parseAndRepairJson(rawText));
  const items = Array.isArray(obj.items) ? obj.items : Array.isArray(obj.events) ? obj.events : [];
  const entities = Array.isArray(obj.entities) ? obj.entities : [];
  const relationships = Array.isArray(obj.relationships) ? obj.relationships : [];
  return { items, events: items, entities, relationships };
}

function parseScoutJson(rawText: string) {
  const entities = asRecord(parseAndRepairJson(rawText)).entities;
  return { entities: Array.isArray(entities) ? entities : [] };
}

function readRenderedPages(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type.toLowerCase() : "";
  const rawPages = Array.isArray(payload.pages) ? payload.pages : [];
  if (type !== "rendered_pages" && !rawPages.length) return null;
  const pages = rawPages.flatMap((row, i) => {
    if (!row || typeof row !== "object") return [];
    const p = row as Record<string, unknown>;
    const image = typeof p.imageBase64 === "string" ? p.imageBase64
      : typeof p.image === "string" ? p.image
      : "";
    if (!image.trim()) return [];
    const pageNumber = Number(p.pageNumber ?? i + 1);
    return [{
      pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? Math.round(pageNumber) : i + 1,
      imageBase64: stripDataUrl(image, "image"),
    }];
  }).slice(0, 5);
  return pages;
}

function readPdfPayload(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type.toLowerCase() : "";
  const mediaType = typeof payload.mediaType === "string" ? payload.mediaType.toLowerCase() : "";
  const filenameGuess = typeof payload.filename === "string" ? payload.filename
    : typeof payload.fileName === "string" ? payload.fileName
    : "";
  const looksPdf = type === "pdf" || mediaType === "application/pdf" || /\.pdf$/i.test(filenameGuess);
  if (!looksPdf) return null;
  const raw = typeof payload.fileBase64 === "string" ? payload.fileBase64
    : typeof payload.pdfBase64 === "string" ? payload.pdfBase64
    : "";
  return stripDataUrl(raw, "pdf");
}

function readImagePayload(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type.toLowerCase() : "";
  const raw = typeof payload.fileBase64 === "string" ? payload.fileBase64
    : typeof payload.imageBase64 === "string" ? payload.imageBase64
    : "";
  if (!raw.trim() || type === "pdf" || type === "rendered_pages") return null;
  const mediaTypeRaw = typeof payload.mediaType === "string" ? payload.mediaType : "image/jpeg";
  const mediaType = /image\/(jpeg|jpg|png|webp|gif)/i.test(mediaTypeRaw)
    ? mediaTypeRaw.replace("image/jpg", "image/jpeg")
    : "image/jpeg";
  return { imageBase64: stripDataUrl(raw, "image"), mediaType };
}

function contentText(data: Record<string, unknown>) {
  const blocks = Array.isArray(data.content) ? data.content : [];
  return blocks
    .map((block) => {
      const row = asRecord(block);
      return row.type === "text" && typeof row.text === "string" ? row.text : "";
    })
    .join("\n")
    .trim();
}

async function callAnthropic(input: {
  apiKey: string;
  system?: string;
  content: string | Array<Record<string, unknown>>;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}) {
  let lastError = "";
  let lastStatus = 502;

  for (const model of MODELS_TO_TRY) {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        ...input.extraHeaders,
      },
      body: JSON.stringify({
        model,
        max_tokens: /claude-3-(sonnet-20240229|haiku-20240307)/.test(model)
          ? Math.min(input.maxTokens, 4096)
          : input.maxTokens,
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: "user", content: input.content }],
      }),
    });

    const errText = await response.text();
    if (response.ok) {
      try {
        const anthropicData = asRecord(JSON.parse(errText || "{}"));
        return contentText(anthropicData) || errText;
      } catch (e: unknown) {
        throw Object.assign(new Error(`Anthropic returned invalid JSON: ${errMessage(e)}`), {
          raw: errText,
          status: 502,
        });
      }
    }

    lastStatus = response.status;
    lastError = `[${model}] ${errText}`;
    if (errText.includes("not_found_error") || response.status === 404) {
      continue;
    }
    throw Object.assign(new Error(`Anthropic API error: ${lastError}`), { status: response.status, raw: errText });
  }

  throw Object.assign(new Error(`Anthropic API error: ${lastError || "No available Claude model."}`), {
    status: lastStatus,
    raw: lastError,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-dossier-key, x-dossier-provider",
  );
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey =
      header(req, "x-dossier-key").trim()
      || header(req, "x-api-key").trim()
      || process.env.ANTHROPIC_API_KEY
      || "";
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing ANTHROPIC_API_KEY in Vercel environment variables. Paste a key in Settings or set ANTHROPIC_API_KEY on the project.",
      });
    }

    const parsedBody = parseRequestBody(req.body);
    if (!parsedBody.ok) {
      return res.status(400).json({ error: parsedBody.error });
    }

    const payload = parsedBody.body;
    const { text, pages, imageBase64, mediaType } = payload;
    const type = typeof payload.type === "string" ? payload.type.toLowerCase() : "";
    const scout = payload.mode === "entities";

    let contentBlocks: Array<Record<string, unknown>> | string | null = null;
    let system: string | undefined = scout ? SCOUT_SYSTEM : EXTRACT_SYSTEM;
    let extraHeaders: Record<string, string> | undefined;
    let maxTokens = 8192;

    const rendered = readRenderedPages(payload);
    if ((type === "rendered_pages" || (Array.isArray(pages) && pages.length > 0)) && rendered) {
      if (!rendered.length) {
        return res.status(400).json({ error: "No text, image, or rendered page payload provided." });
      }
      contentBlocks = [];
      for (const p of rendered) {
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: p.imageBase64.replace(/^data:image\/\w+;base64,/, ""),
          },
        });
      }
      contentBlocks.push({ type: "text", text: RENDERED_PAGES_USER_TEXT });
    } else {
      const pdf = readPdfPayload(payload);
      if (type === "pdf" || pdf) {
        if (!pdf) {
          return res.status(400).json({ error: "No text, image, or rendered page payload provided." });
        }
        extraHeaders = { "anthropic-beta": "pdfs-2024-09-25" };
        system = undefined;
        contentBlocks = [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdf.replace(/^data:application\/pdf;base64,/, ""),
            },
          },
          { type: "text", text: PDF_USER_TEXT },
        ];
      } else {
        const image = readImagePayload(payload) || (typeof imageBase64 === "string" && imageBase64.trim()
          ? {
            imageBase64: stripDataUrl(imageBase64, "image"),
            mediaType: typeof mediaType === "string" ? mediaType : "image/jpeg",
          }
          : null);
        if (image?.imageBase64) {
          contentBlocks = [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType || "image/jpeg",
                data: image.imageBase64.replace(/^data:image\/\w+;base64,/, ""),
              },
            },
            { type: "text", text: VISION_USER_TEXT },
          ];
        } else if (typeof text === "string" && text.trim()) {
          const clipped = String(text).slice(0, 15000);
          if (scout) {
            contentBlocks = `Extract people, locations, vehicles, timestamps, and evidence items from this text:
"""
${clipped}
"""
${OUTPUT_BUDGET}
Return strictly a JSON object: { "entities": [] }`;
          } else {
            contentBlocks = `Extract people, locations, vehicles, timestamps, and evidence items from this text:
"""
${clipped}
"""
${OUTPUT_BUDGET}
Return strictly a JSON object: { "items": [], "entities": [], "relationships": [] }`;
          }
        }
      }
    }

    if (!contentBlocks) {
      return res.status(400).json({ error: "No text, image, or rendered page payload provided." });
    }

    const rawText = await callAnthropic({
      apiKey,
      system,
      content: contentBlocks,
      maxTokens,
      extraHeaders,
    });

    if (scout) return res.status(200).json(parseScoutJson(rawText));
    return res.status(200).json(parseModelJson(rawText));
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
    const raw = err && typeof err === "object" && "raw" in err ? String((err as { raw?: unknown }).raw || "") : "";
    const message = errMessage(err);
    console.error("Unhandled extraction failure:", message, raw.slice(0, 800));
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: message || "Unhandled server error",
      ...(raw ? { raw: raw.slice(0, 4000) } : {}),
    });
  }
}
