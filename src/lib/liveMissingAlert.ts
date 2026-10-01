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
  /** True when NCMEC was unreachable and last-good or sample items are shown. */
  offline?: boolean;
  sources: MissingAlertSourceStatus[];
  warning?: string;
};

/** Demo items used only when the live NCMEC RSS cannot be reached. */
export const FALLBACK_MISSING_ALERTS: LiveMissingAlert[] = [
  {
    id: "fallback-amber-maricopa",
    name: "Jordan Hale",
    age: "8",
    alertType: "AMBER Alert",
    location: "Phoenix, AZ",
    timestamp: "2026-09-29T18:40:00.000Z",
    summary:
      "AMBER Alert (sample cache): Jordan Hale, Age Now: 8, Missing: 09/29/2026. Last seen near Encanto Park, Phoenix, AZ. Vehicle: silver sedan, Arizona plates. ANYONE HAVING INFORMATION SHOULD CONTACT: Phoenix Police Department 1-602-262-6151.",
    externalUrl: "https://www.missingkids.org/gethelpnow/amber",
  },
  {
    id: "fallback-advisory-cook",
    name: "Elena Vasquez",
    age: "72",
    alertType: "Silver Alert",
    location: "Cook County, IL",
    timestamp: "2026-09-28T14:15:00.000Z",
    summary:
      "Cook County, IL advisory (sample cache): Elena Vasquez, Age Now: 72, Missing: 09/28/2026. Missing From Cicero, IL. Last seen walking near Cermak Road. Silver Alert issued for an endangered adult. ANYONE HAVING INFORMATION SHOULD CONTACT: Cook County Sheriff's Office 1-312-603-6444.",
    externalUrl: "https://www.missingkids.org/gethelpnow",
  },
  {
    id: "fallback-endangered-ncmc",
    name: "Malik Reed",
    age: "15",
    alertType: "Endangered Missing",
    location: "Houston, TX",
    timestamp: "2026-09-27T21:05:00.000Z",
    summary:
      "Endangered Missing (sample cache): Malik Reed, Age Now: 15, Missing: 09/27/2026. Missing From Houston, TX. Last seen after school near Third Ward. ANYONE HAVING INFORMATION SHOULD CONTACT: Houston Police Department 1-713-884-3131.",
    externalUrl: "https://www.missingkids.org/gethelpnow/search",
  },
];

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
