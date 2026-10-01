import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { dispatchExtract, ExtractHttpError } from "./server/extract.ts";
import { scrapePublicArticle, parsePageMetadata, ScrapeHttpError } from "./server/scrapeUrl.ts";
import { parseIntelWithAnthropic, IntelParseError } from "./server/parseIntel.ts";
import { EXTRACT_MAX_CHARS, prioritizeLegalFacts } from "./src/lib/extractSchema.ts";
import { getMissingAlerts } from "./server/missingAlerts.ts";
import { FALLBACK_MISSING_ALERTS } from "./src/lib/liveMissingAlert.ts";
import { lookupNamus } from "./server/namusLookup.ts";

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
      let payload: Record<string, unknown> = {};
      const rawBody = await readBody(req);
      try {
        payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      } catch {
        payload = { text: rawBody };
      }
      if (typeof payload.text === "string") {
        payload = { ...payload, text: prioritizeLegalFacts(payload.text, EXTRACT_MAX_CHARS) };
      }

      const headerKey = req.headers["x-dossier-key"];
      const headerProvider = req.headers["x-dossier-provider"];
      const result = await dispatchExtract({
        payload,
        headerKey: typeof headerKey === "string" ? headerKey : "",
        headerProvider: typeof headerProvider === "string" ? headerProvider : "",
        env,
      });
      send(res, result.status, result.body);
    } catch (err) {
      const status = err instanceof ExtractHttpError ? err.status : 200;
      const message = err instanceof Error ? err.message : "Extraction failed.";
      console.error("[Extraction] Handler error", status, message);
      if (status === 401) {
        send(res, 200, { error: message, engine: "gpt-4o", events: [], items: [], entities: [], relationships: [] });
        return;
      }
      send(res, 200, { engine: "gpt-4o", events: [], items: [], entities: [], relationships: [], warning: message });
    }
  };

  const metadataHandler = async (req: IncomingMessage, res: ServerResponse) => {
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
      const meta = await parsePageMetadata(payload.url || "");
      send(res, 200, meta);
    } catch (err) {
      const status = err instanceof ScrapeHttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Metadata parse failed.";
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

  const alertsHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      if (req.method !== "GET") {
        send(res, 200, {
          alerts: FALLBACK_MISSING_ALERTS,
          fetchedAt: new Date().toISOString(),
          cached: true,
          offline: true,
          sources: [],
          warning: "GET only",
        });
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const body = await getMissingAlerts({
        state: url.searchParams.get("state") || "",
        env,
        bypassCache: url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true",
      });
      send(res, 200, body);
    } catch (err) {
      console.error("[alerts] local handler failed", err);
      send(res, 200, {
        alerts: FALLBACK_MISSING_ALERTS,
        fetchedAt: new Date().toISOString(),
        cached: true,
        offline: true,
        sources: [],
        warning: "NCMEC feed temporarily unreachable",
      });
    }
  };

  const namusHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const query = url.searchParams.get("id") || url.searchParams.get("url") || url.searchParams.get("q") || "";
      const body = await lookupNamus(query);
      send(res, 200, body);
    } catch (err) {
      console.error("[namus] local handler failed", err);
      send(res, 200, { error: "NamUs lookup failed." });
    }
  };

  const mountApis = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void } }) => {
    server.middlewares.use("/api/extract", (req, res) => { void handler(req, res); });
    server.middlewares.use("/api/scrape-url", (req, res) => { void scrapeHandler(req, res); });
    server.middlewares.use("/api/parseMetadata", (req, res) => { void metadataHandler(req, res); });
    server.middlewares.use("/api/parse-metadata", (req, res) => { void metadataHandler(req, res); });
    server.middlewares.use("/api/parse-intel", (req, res) => { void intelHandler(req, res); });
    server.middlewares.use("/api/alerts/missing", (req, res) => { void alertsHandler(req, res); });
    server.middlewares.use("/api/namus", (req, res) => { void namusHandler(req, res); });
  };

  return {
    name: "dossier-extract-api",
    configureServer(server) {
      mountApis(server);
    },
    configurePreviewServer(server) {
      mountApis(server);
    },
  };
}
