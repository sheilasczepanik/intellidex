import type { MissingAlertsResponse } from "./liveMissingAlert";

export async function fetchMissingAlerts(opts?: { state?: string; refresh?: boolean }): Promise<MissingAlertsResponse> {
  const params = new URLSearchParams();
  if (opts?.state) params.set("state", opts.state);
  if (opts?.refresh) params.set("refresh", "1");
  const qs = params.toString();
  const res = await fetch(`/api/alerts/missing${qs ? `?${qs}` : ""}`);
  const rawText = await res.text();
  let json: Partial<MissingAlertsResponse> & { error?: string } = {};
  try {
    json = rawText ? JSON.parse(rawText) as Partial<MissingAlertsResponse> & { error?: string } : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    throw new Error(json.error || json.warning || `Alert feed failed (${res.status})`);
  }
  return {
    alerts: Array.isArray(json.alerts) ? json.alerts : [],
    fetchedAt: typeof json.fetchedAt === "string" ? json.fetchedAt : new Date().toISOString(),
    cached: Boolean(json.cached),
    sources: Array.isArray(json.sources) ? json.sources : [],
    warning: typeof json.warning === "string" ? json.warning : undefined,
  };
}
