type NodeLikeReq = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
};

function parseJsonQuiet(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function asRecord(body: unknown): Record<string, unknown> | null {
  if (body == null) return null;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) {
    return parseJsonQuiet(body.toString("utf8").trim());
  }
  if (typeof body === "string") return parseJsonQuiet(body.trim());
  if (typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  return null;
}

/** Pull `text` from a Vercel/Vite body without throwing on malformed JSON. */
export function textFromUnknownBody(body: unknown): { text: string; payload: Record<string, unknown> } {
  let payload: Record<string, unknown> = {};
  let text = "";
  if (typeof body === "string") {
    const parsed = parseJsonQuiet(body);
    if (parsed) {
      payload = parsed;
      text = typeof parsed.text === "string" ? parsed.text : "";
    } else {
      text = body;
    }
  } else if (body && typeof body === "object") {
    payload = body as Record<string, unknown>;
    text = typeof payload.text === "string" ? payload.text : "";
  }
  return { text, payload };
}

/** Vercel may pre-parse JSON; local Vite always sends a raw stream. Never throws. */
export async function readJsonBody(req: NodeLikeReq): Promise<Record<string, unknown>> {
  const fromBody = asRecord(req.body);
  if (fromBody && (typeof fromBody.text === "string" || Object.keys(fromBody).length > 0)) {
    return fromBody;
  }
  if (typeof req[Symbol.asyncIterator] !== "function") return fromBody ?? {};

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<unknown>) {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return fromBody ?? {};
    return parseJsonQuiet(raw) ?? (fromBody ?? {});
  } catch (err) {
    console.error("[Extraction] Body read failed:", err instanceof Error ? err.message : err);
    return fromBody ?? {};
  }
}
