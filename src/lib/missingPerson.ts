import type { CaseRecord, CaseStatus, EntityRecord, TimelineEventRecord } from "../db/schema";

export const ALERT_LEVELS = [
  "ACTIVE_MISSING",
  "ENDANGERED_MISSING",
  "CRITICAL_MEDICAL",
  "COLD",
] as const;

export type AlertLevel = (typeof ALERT_LEVELS)[number];

export const SEARCH_LOCATION_KINDS = ["last_seen", "item_recovered", "cell_ping", "search_grid"] as const;
export type SearchLocationKind = (typeof SEARCH_LOCATION_KINDS)[number];

export const SEARCH_STATUSES = ["Active Search", "Cleared", "Unchecked"] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

export function isAlertLevel(value: string | undefined | null): value is AlertLevel {
  return ALERT_LEVELS.includes(String(value) as AlertLevel);
}

export function normalizeAlertLevel(status: string | undefined | null): AlertLevel | CaseStatus {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE" || s === "FIELD") return "ACTIVE_MISSING";
  if (s === "REVIEW") return "ENDANGERED_MISSING";
  if (s === "ACTIVE_MISSING" || s === "ENDANGERED_MISSING" || s === "CRITICAL_MEDICAL" || s === "COLD") return s;
  if (s === "ARCHIVED" || s === "CLOSED") return s as CaseStatus;
  return "ACTIVE_MISSING";
}

export function formatAlertLabel(status: string | undefined | null) {
  const s = String(status || "").toUpperCase();
  if (s === "ENDANGERED_MISSING" || s === "REVIEW") return "Endangered Missing";
  if (s === "CRITICAL_MEDICAL") return "Critical Medical Need";
  if (s === "COLD") return "Cold Case";
  if (s === "ARCHIVED") return "Archived";
  if (s === "CLOSED") return "Closed";
  if (s === "ACTIVE_MISSING" || s === "ACTIVE" || s === "FIELD") return "Active Missing";
  return status?.replace(/_/g, " ") || "Active Missing";
}

/** WCAG AA chips for search urgency. */
export function alertToneClass(status: string | undefined | null) {
  const s = String(status || "").toUpperCase();
  if (s === "CRITICAL_MEDICAL") return "border-orange-400 bg-orange-50 text-orange-950";
  if (s === "ENDANGERED_MISSING" || s === "REVIEW") return "border-amber-400 bg-amber-50 text-amber-950";
  if (s === "COLD" || s === "ARCHIVED" || s === "CLOSED") return "border-slate-300 bg-slate-100 text-slate-800";
  return "border-slate-300 bg-slate-50 text-slate-900";
}

export function isUrgentAlert(status: string | undefined | null) {
  const s = String(status || "").toUpperCase();
  return s === "ENDANGERED_MISSING" || s === "CRITICAL_MEDICAL" || s === "REVIEW";
}

export function parseLksTimestamp(activeCase: CaseRecord | null | undefined): number | null {
  if (!activeCase) return null;
  const raw = (activeCase.lksAt || "").trim();
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  const day = (activeCase.incidentStart || "").trim();
  if (day) {
    const ms = Date.parse(day.includes("T") ? day : `${day}T12:00:00`);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function formatTimeMissing(fromMs: number | null, now = Date.now()) {
  if (fromMs == null || !Number.isFinite(fromMs) || fromMs > now) return "Missing: time unknown";
  const totalMin = Math.max(0, Math.floor((now - fromMs) / 60000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const remDays = days % 365;
    const months = Math.floor(remDays / 30);
    const yearLabel = `${years} year${years === 1 ? "" : "s"}`;
    return months ? `Missing: ${yearLabel}, ${months} month${months === 1 ? "" : "s"}` : `Missing: ${yearLabel}`;
  }
  if (days >= 1) return `Missing: ${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours >= 1) {
    const mins = totalMin % 60;
    return `Missing: ${hours} hour${hours === 1 ? "" : "s"}, ${mins} min`;
  }
  return `Missing: ${Math.max(1, totalMin)} min`;
}

export function formatElapsedCompact(fromMs: number | null, now = Date.now()) {
  if (fromMs == null || !Number.isFinite(fromMs) || fromMs > now) return "—";
  const totalMin = Math.max(0, Math.floor((now - fromMs) / 60000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, totalMin)}m`;
}

export function subjectDisplayName(activeCase: CaseRecord) {
  return activeCase.subjectName?.trim() || activeCase.title?.trim() || "Unnamed subject";
}

export function inferSearchLocationKind(entity: EntityRecord): SearchLocationKind {
  const kind = String(entity.metadata?.locationKind || "").toLowerCase();
  if ((SEARCH_LOCATION_KINDS as readonly string[]).includes(kind)) return kind as SearchLocationKind;
  const blob = `${entity.role} ${entity.classification} ${entity.notes} ${entity.name}`.toLowerCase();
  if (/cell|tower|ping|sector/.test(blob)) return "cell_ping";
  if (/grid|trail|search zone|canvass/.test(blob)) return "search_grid";
  if (/vehicle|belonging|recovered|abandoned|item/.test(blob)) return "item_recovered";
  if (/last seen|lks|last known/.test(blob)) return "last_seen";
  return "search_grid";
}

export function formatLocationKindLabel(kind: SearchLocationKind) {
  if (kind === "last_seen") return "Last Seen Point";
  if (kind === "item_recovered") return "Vehicle / Belongings Found";
  if (kind === "cell_ping") return "Cell Tower Sector / Ping";
  return "Searched Grid / Trail Area";
}

export function inferSearchStatus(entity: EntityRecord): SearchStatus {
  const raw = String(entity.metadata?.searchStatus || entity.classification || "").trim();
  if ((SEARCH_STATUSES as readonly string[]).includes(raw)) return raw as SearchStatus;
  const blob = `${raw} ${entity.notes} ${entity.role}`.toLowerCase();
  if (/cleared|complete|negative/.test(blob)) return "Cleared";
  if (/active|ongoing|in progress/.test(blob)) return "Active Search";
  return "Unchecked";
}

export function searchStatusClass(status: SearchStatus) {
  if (status === "Active Search") return "border-amber-400 bg-amber-50 text-amber-950";
  if (status === "Cleared") return "border-slate-700 bg-slate-800 text-white";
  return "border-slate-300 bg-slate-50 text-slate-800";
}

export function isVerifiedSighting(event: TimelineEventRecord) {
  if (!event.isVerified) return false;
  if (event.tier === "secondary") return false;
  const blob = `${event.title} ${event.description}`.toLowerCase();
  return /sighting|last seen|lks|video still|anpr|camera|witnessed/.test(blob);
}

export function isOpenTip(event: TimelineEventRecord) {
  if (event.tier === "secondary") return !event.isVerified;
  const blob = `${event.title} ${event.description}`.toLowerCase();
  return /tip|lead|community|anonymous/.test(blob) && !event.isVerified;
}

export type TimelineBucket = "pre" | "lks" | "search";

export function bucketTimelineEvent(event: TimelineEventRecord, lksMs: number | null): TimelineBucket {
  const blob = `${event.title} ${event.description}`.toLowerCase();
  if (/last known sighting|\blks\b|last seen/.test(blob)) return "lks";
  if (lksMs == null) return "search";
  const window = 45 * 60 * 1000;
  if (Math.abs(event.timestamp - lksMs) <= window) return "lks";
  if (event.timestamp < lksMs) return "pre";
  return "search";
}

export function mapContactAffiliation(role: string, relation?: string) {
  const blob = `${role} ${relation || ""}`.toLowerCase();
  if (/detect|agency|trooper|officer|sheriff/.test(blob)) return "Lead Detective / Agency";
  if (/search|rescue|sar|k-9|k9/.test(blob)) return "Search & Rescue Lead";
  if (/family|liaison|next of kin|parent|sibling/.test(blob)) return "Family Liaison";
  if (/report|caller|911/.test(blob)) return "Reporting Party";
  if (/last contact|associate|friend|roommate/.test(blob)) return "Last Contacted Associate";
  return relation?.trim() || role.trim() || "Other";
}
