import { FALLBACK_MISSING_ALERTS, type MissingAlertsResponse } from "./liveMissingAlert";

function asResponse(json: Partial<MissingAlertsResponse> & { error?: string }, offline = false): MissingAlertsResponse {
  const alerts = Array.isArray(json.alerts) && json.alerts.length ? json.alerts : (offline ? FALLBACK_MISSING_ALERTS : []);
  return {
    alerts,
    fetchedAt: typeof json.fetchedAt === "string" ? json.fetchedAt : new Date().toISOString(),
    cached: Boolean(json.cached) || offline,
    offline: Boolean(json.offline) || offline,
    sources: Array.isArray(json.sources) ? json.sources : [],
    warning: typeof json.warning === "string"
      ? json.warning
      : (offline ? "NCMEC feed temporarily unreachable" : undefined),
  };
}

export async function fetchMissingAlerts(opts?: { state?: string; refresh?: boolean }): Promise<MissingAlertsResponse> {
  const params = new URLSearchParams();
  if (opts?.state) params.set("state", opts.state);
  if (opts?.refresh) params.set("refresh", "1");
  const qs = params.toString();
  const path = `/api/alerts/missing${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(path);
    const rawText = await res.text();
    let json: Partial<MissingAlertsResponse> & { error?: string } = {};
    try {
      json = rawText ? JSON.parse(rawText) as Partial<MissingAlertsResponse> & { error?: string } : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      console.error("[alerts] API HTTP", res.status, json.error || json.warning);
      return asResponse(json, true);
    }
    const parsed = asResponse(json, Boolean(json.offline));
    if (!parsed.alerts.length && (parsed.offline || parsed.warning)) {
      return asResponse(json, true);
    }
    return parsed;
  } catch (err) {
    console.error("[alerts] client fetch failed", err);
    return asResponse({}, true);
  }
}
