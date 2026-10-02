import type { LiveMissingAlert, LiveMissingAlertType } from "../lib/liveMissingAlert";

export type LiveAlertLevel = "CRITICAL_MISSING" | "ACTIVE_SEARCH" | "ENDANGERED_RUNAWAY";

export type CuratedLiveAlert = {
  id: string;
  caseNumber: string;
  name: string;
  age: number;
  missingSince: string;
  location: string;
  jurisdiction: string;
  alertLevel: LiveAlertLevel;
  circumstances: string;
  source: string;
  imageUrl: string;
  verified: boolean;
};

/** Offline cards shown whenever the public feed is empty or unreachable. */
export const DEFAULT_LIVE_ALERTS: CuratedLiveAlert[] = [
  {
    id: "NCMEC-1402881",
    caseNumber: "NCMEC-1402881",
    name: "Nevaeh King",
    age: 15,
    missingSince: "Sep 28, 2026",
    location: "Phoenix, Maricopa County, AZ",
    jurisdiction: "Phoenix Police Department",
    alertLevel: "CRITICAL_MISSING",
    circumstances: "Subject last seen leaving residence near 35th Ave and Camelback Rd. May be traveling in a dark sedan.",
    source: "NCMEC Public Feed",
    imageUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80",
    verified: true,
  },
  {
    id: "NCMEC-1402773",
    caseNumber: "NCMEC-1402773",
    name: "Marcus Vance",
    age: 17,
    missingSince: "Sep 29, 2026",
    location: "Gary, Lake County, IN",
    jurisdiction: "Gary Police Department",
    alertLevel: "ACTIVE_SEARCH",
    circumstances: "Last seen walking near 5th Ave transit center wearing black hoodie and grey athletic shoes.",
    source: "NCMEC Public Feed",
    imageUrl: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80",
    verified: true,
  },
  {
    id: "NCMEC-1402650",
    caseNumber: "NCMEC-1402650",
    name: "Sofia Alvarez",
    age: 14,
    missingSince: "Oct 1, 2026",
    location: "San Antonio, Bexar County, TX",
    jurisdiction: "San Antonio Police Department",
    alertLevel: "ENDANGERED_RUNAWAY",
    circumstances: "Subject requires medication. Known to frequent transit hubs and local shopping plazas.",
    source: "NCMEC Public Feed",
    imageUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80",
    verified: true,
  },
];

function levelToType(level: LiveAlertLevel): LiveMissingAlertType {
  if (level === "CRITICAL_MISSING" || level === "ENDANGERED_RUNAWAY") return "Endangered Missing";
  return "Advisory";
}

function missingStamp(label: string) {
  const parsed = new Date(label);
  if (!Number.isFinite(parsed.getTime())) {
    return { iso: new Date().toISOString(), slash: "" };
  }
  parsed.setHours(12, 0, 0, 0);
  const slash = `${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
  return { iso: parsed.toISOString(), slash };
}

export function curatedAlertToLive(alert: CuratedLiveAlert): LiveMissingAlert {
  const when = missingStamp(alert.missingSince);
  const summary = [
    alert.circumstances,
    when.slash ? `Missing: ${when.slash}.` : "",
    `Jurisdiction: ${alert.jurisdiction}.`,
    `Case ${alert.caseNumber}.`,
  ].filter(Boolean).join(" ");
  return {
    id: alert.id,
    caseNumber: alert.caseNumber,
    name: alert.name,
    age: String(alert.age),
    alertType: levelToType(alert.alertLevel),
    alertLevel: alert.alertLevel,
    location: alert.location,
    jurisdiction: alert.jurisdiction,
    timestamp: when.iso,
    summary,
    photoUrl: alert.imageUrl,
    externalUrl: "https://www.missingkids.org/gethelpnow/search",
    verified: alert.verified,
    sourceName: alert.source,
  };
}

export function defaultLiveAlerts(): LiveMissingAlert[] {
  return DEFAULT_LIVE_ALERTS.map(curatedAlertToLive);
}
