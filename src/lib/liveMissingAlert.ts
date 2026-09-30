export const LIVE_MISSING_ALERT_TYPES = [
  "AMBER Alert",
  "Endangered Missing",
  "Silver Alert",
  "Advisory",
] as const;

export type LiveMissingAlertType = (typeof LIVE_MISSING_ALERT_TYPES)[number];

export interface LiveMissingAlert {
  id: string;
  name: string;
  age?: string;
  alertType: LiveMissingAlertType;
  location: string;
  timestamp: string;
  summary: string;
  photoUrl?: string;
  externalUrl: string;
}

export type MissingAlertSourceStatus = {
  url: string;
  title?: string;
  ok: boolean;
  itemCount?: number;
  error?: string;
};

export type MissingAlertsResponse = {
  alerts: LiveMissingAlert[];
  fetchedAt: string;
  cached: boolean;
  sources: MissingAlertSourceStatus[];
  warning?: string;
};

export function classifyLiveAlertType(text: string): LiveMissingAlertType {
  const blob = text.toLowerCase();
  if (/\bamber\b/.test(blob)) return "AMBER Alert";
  if (/\bsilver\b/.test(blob)) return "Silver Alert";
  if (/\bendangered\b|\bcritical\b|\bchild\b|\bmissing children\b/.test(blob)) return "Endangered Missing";
  return "Advisory";
}

export function alertTypeToCaseStatus(alertType: LiveMissingAlertType) {
  if (alertType === "AMBER Alert") return "ENDANGERED_MISSING" as const;
  if (alertType === "Endangered Missing") return "ENDANGERED_MISSING" as const;
  return "ACTIVE_MISSING" as const;
}

/** Best-effort last-seen timestamp from NCMEC-style "Missing: MM/DD/YYYY" copy. */
export function parseAlertMissingAt(summary: string) {
  const m = summary.match(/Missing:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!m) return "";
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}T12:00`;
}
