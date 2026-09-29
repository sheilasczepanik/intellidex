const KEY = "dossier.apiKey";
const PROVIDER = "dossier.provider";

export type LlmProvider = "anthropic" | "openai";

export function getLocalApiKey() {
  return localStorage.getItem(KEY) ?? "";
}

export function setLocalApiKey(value: string) {
  const trimmed = value.trim();
  if (trimmed) localStorage.setItem(KEY, trimmed);
  else localStorage.removeItem(KEY);
}

export function getLocalProvider(): LlmProvider {
  return localStorage.getItem(PROVIDER) === "openai" ? "openai" : "anthropic";
}

export function setLocalProvider(value: LlmProvider) {
  localStorage.setItem(PROVIDER, value);
}
