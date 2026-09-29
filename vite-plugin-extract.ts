import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ExtractHttpError, runEntityScout, runExtraction, runPdfExtraction, runRenderedPagesExtraction, runVisionExtraction } from "./server/extract.ts";
import { scrapePublicArticle, ScrapeHttpError } from "./server/scrapeUrl.ts";
import { parseIntelWithAnthropic, IntelParseError } from "./server/parseIntel.ts";
import { MODEL_NAME } from "./server/anthropicModels.ts";
import { sanitizeExtractText } from "./src/lib/extractSchema.ts";

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function extractApiPlugin(env: Record<string, string>): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "POST only" });
      return;
    }

    try {
      let payload: {
        type?: string;
        text?: string;
        fileName?: string;
        filename?: string;
        mode?: string;
        summary?: boolean;
        maxPages?: number;
        maxChars?: number;
        imageBase64?: string;
        fileBase64?: string;
        mediaType?: string;
        pages?: { pageNumber?: number; imageBase64?: string }[];
        entities?: { id: string; name: string; type: string; role: string }[];
      } = {};
      const rawBody = await readBody(req);
      try {
        payload = JSON.parse(rawBody || "{}") as typeof payload;
      } catch {
        payload = { text: rawBody };
      }

      const headerKey = req.headers["x-dossier-key"];
      const headerProvider = req.headers["x-dossier-provider"];
      const apiKey = (typeof headerKey === "string" && headerKey.trim())
        || env.ANTHROPIC_API_KEY
        || env.VITE_ANTHROPIC_API_KEY
        || env.OPENAI_API_KEY
        || env.VITE_OPENAI_API_KEY
        || "";
      if (!apiKey) {
        send(res, 401, {
          error: "No API key. Add ANTHROPIC_API_KEY to .env.local or paste a key in Settings.",
        });
        return;
      }

      const kind = (payload.type || "").toLowerCase();
      const fileName = payload.filename || payload.fileName || "evidence";

      if (kind === "rendered_pages") {
        const bundle = await runRenderedPagesExtraction({
          pages: (payload.pages ?? []).map((p, i) => ({
            pageNumber: p.pageNumber || i + 1,
            imageBase64: p.imageBase64 || "",
          })),
          fileName,
          apiKey,
          anthropicModel: env.ANTHROPIC_MODEL || MODEL_NAME,
        });
        send(res, 200, { events: bundle.events, items: bundle.events, entities: bundle.entities, relationships: bundle.relationships });
        return;
      }

      if (kind === "pdf" || (payload.fileBase64 && (payload.mediaType === "application/pdf" || /\.pdf$/i.test(fileName)))) {
        const bundle = await runPdfExtraction({
          fileBase64: payload.fileBase64 || "",
          fileName,
          apiKey,
          anthropicModel: env.ANTHROPIC_MODEL || MODEL_NAME,
        });
        send(res, 200, { events: bundle.events, items: bundle.events, entities: bundle.entities, relationships: bundle.relationships });
        return;
      }

      if (kind === "image" || payload.imageBase64 || (kind !== "text" && payload.fileBase64 && (payload.mediaType || "").startsWith("image/"))) {
        const bundle = await runVisionExtraction({
          imageBase64: payload.fileBase64 || payload.imageBase64 || "",
          mediaType: payload.mediaType,
          fileName,
          apiKey,
          anthropicModel: env.ANTHROPIC_MODEL || MODEL_NAME,
        });
        send(res, 200, { events: bundle.events, items: bundle.events, entities: bundle.entities, relationships: bundle.relationships });
        return;
      }

      const text = sanitizeExtractText(payload.text ?? "", 10_000);
      console.log("[Extraction] Incoming text length:", text.length);
      console.log("[Extraction] First 300 characters:", text.slice(0, 300));
      if (!text || text.length < 20) {
        send(res, 400, { error: "PDF text layer is empty or unreadable OCR noise." });
        return;
      }

      const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY);
      const hasOpenAi = Boolean(env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY);
      const resolvedProvider: "anthropic" | "openai" =
        (typeof headerProvider === "string" && headerProvider === "openai")
        || (!hasAnthropic && hasOpenAi)
          ? "openai"
          : "anthropic";
      const shared = {
        text,
        fileName: payload.fileName || "pasted-notes.txt",
        entities: payload.entities ?? [],
        apiKey,
        provider: resolvedProvider,
        anthropicModel: env.ANTHROPIC_MODEL,
        openaiModel: env.OPENAI_MODEL,
        summary: payload.summary,
        maxPages: payload.maxPages,
        maxChars: 10_000,
      };

      if (payload.mode === "entities") {
        const entities = await runEntityScout(shared);
        send(res, 200, { entities });
        return;
      }

      const bundle = await runExtraction(shared);
      send(res, 200, { events: bundle.events, items: bundle.events, entities: bundle.entities, relationships: bundle.relationships });
    } catch (err) {
      const status = err instanceof ExtractHttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Extraction failed.";
      console.error("[Extraction] Handler error", status, message);
      send(res, status, { error: message });
    }
  };

  const scrapeHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "POST only" });
      return;
    }
    try {
      const rawBody = await readBody(req);
      let payload: { url?: string } = {};
      try {
        payload = JSON.parse(rawBody || "{}") as { url?: string };
      } catch {
        payload = {};
      }
      const article = await scrapePublicArticle(payload.url || "");
      send(res, 200, article);
    } catch (err) {
      const status = err instanceof ScrapeHttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Scrape failed.";
      send(res, status, { error: message });
    }
  };

  const intelHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "POST only" });
      return;
    }
    try {
      const rawBody = await readBody(req);
      let payload: { text?: string; rawContent?: string } = {};
      try {
        payload = JSON.parse(rawBody || "{}") as { text?: string; rawContent?: string };
      } catch {
        payload = {};
      }
      const headerKey = req.headers["x-dossier-key"];
      const apiKey = (typeof headerKey === "string" && headerKey.trim())
        || env.ANTHROPIC_API_KEY
        || env.VITE_ANTHROPIC_API_KEY
        || "";
      if (!apiKey) {
        send(res, 500, { error: "Server configuration error: ANTHROPIC_API_KEY is not set in Vercel environment variables." });
        return;
      }
      const text = payload.text || payload.rawContent || "";
      if (text.trim().length < 12) {
        send(res, 400, { error: "Raw intel / tip transcript is empty or too short." });
        return;
      }
      const claims = await parseIntelWithAnthropic(apiKey, text);
      send(res, 200, { claims });
    } catch (err) {
      const status = err instanceof IntelParseError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Intel parse failed.";
      send(res, status, { error: message });
    }
  };

  return {
    name: "dossier-extract-api",
    configureServer(server) {
      server.middlewares.use("/api/extract", (req, res) => {
        void handler(req, res);
      });
      server.middlewares.use("/api/scrape-url", (req, res) => {
        void scrapeHandler(req, res);
      });
      server.middlewares.use("/api/parse-intel", (req, res) => {
        void intelHandler(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/extract", (req, res) => {
        void handler(req, res);
      });
      server.middlewares.use("/api/scrape-url", (req, res) => {
        void scrapeHandler(req, res);
      });
      server.middlewares.use("/api/parse-intel", (req, res) => {
        void intelHandler(req, res);
      });
    },
  };
}
