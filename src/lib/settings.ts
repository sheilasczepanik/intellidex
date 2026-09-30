const KEY = "dossier.apiKey";
const PROVIDER = "dossier.provider";

export type LlmProvider = "gemini" | "openai" | "anthropic";

export function getLocalApiKey() {
  return localStorage.getItem(KEY) ?? "";
}

export function setLocalApiKey(value: string) {
  const trimmed = value.trim();
  if (trimmed) localStorage.setItem(KEY, trimmed);
  else localStorage.removeItem(KEY);
}

export function getLocalProvider(): LlmProvider {
  const stored = localStorage.getItem(PROVIDER);
  if (stored === "gemini" || stored === "openai" || stored === "anthropic") return stored;
  return "openai";
}

export function setLocalProvider(value: LlmProvider) {
  localStorage.setItem(PROVIDER, value);
}
