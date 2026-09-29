export const MODEL_NAME = "claude-3-5-sonnet-20240620";

const FALLBACK_MODELS = [
  "claude-sonnet-5-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  MODEL_NAME,
];

export function resolveAnthropicModels(preferred?: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [
    preferred?.trim(),
    process.env.ANTHROPIC_MODEL?.trim(),
    MODEL_NAME,
    ...FALLBACK_MODELS,
  ]) {
    if (!id || seen.has(id)) continue;
    if (id.includes("20241022")) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function isAnthropicModelMissing(status: number, body: string) {
  const blob = body.toLowerCase();
  return (
    status === 404
    || blob.includes("not_found_error")
    || (blob.includes("\"type\":\"not_found_error\"") )
    || /model:\s*claude/i.test(body) && blob.includes("not_found")
  );
}

export async function postAnthropicMessages(input: {
  apiKey: string;
  system?: string;
  user: string | Array<Record<string, unknown>>;
  maxTokens: number;
  extraHeaders?: Record<string, string>;
  preferredModel?: string;
}): Promise<string> {
  const models = resolveAnthropicModels(input.preferredModel);
  let lastStatus = 500;
  let lastBody = "";

  for (const model of models) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        ...input.extraHeaders,
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens,
        ...(input.system ? { system: input.system } : {}),
        messages: [{ role: "user", content: input.user }],
      }),
    });
    const body = await res.text();
    if (res.ok) {
      if (model !== models[0]) console.warn("[Anthropic] Fell back to model", model);
      return body;
    }
    lastStatus = res.status;
    lastBody = body;
    if (isAnthropicModelMissing(res.status, body)) {
      console.warn("[Anthropic] Model not found, trying next identifier:", model, body.slice(0, 240));
      continue;
    }
    const err = new Error(`Anthropic API error: ${body.slice(0, 1200) || res.statusText}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const err = new Error(`Anthropic API error: ${lastBody.slice(0, 1200) || "No available Claude model."}`) as Error & { status?: number };
  err.status = lastStatus;
  throw err;
}
