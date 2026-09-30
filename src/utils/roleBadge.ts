export const PERSON_ROLE_VALUES = [
  "MISSING_PERSON",
  "SUSPECT",
  "person_of_interest",
  "WITNESS",
  "VICTIM",
  "ASSOCIATE",
  "UNVERIFIED",
] as const;

export type PersonRoleValue = (typeof PERSON_ROLE_VALUES)[number];

const VICTIM_IDLE = "bg-rose-50 text-rose-600 border border-rose-200";
const VICTIM_ON = "bg-rose-600 text-white border border-rose-600 shadow-sm ring-2 ring-rose-400/40";
const SUSPECT_IDLE = "bg-blue-50 text-blue-600 border border-blue-200";
const SUSPECT_ON = "bg-blue-600 text-white border border-blue-600 shadow-sm ring-2 ring-blue-400/40";
const NEUTRAL_IDLE = "bg-slate-50 text-slate-600 border border-slate-200";
const NEUTRAL_ON = "bg-slate-800 text-white border border-slate-800 shadow-sm ring-2 ring-slate-400/30";

export const VICTIM_CHIP = VICTIM_IDLE;

/** WCAG AA circular avatar for victims / deceased (red-600 on red-50). */
export const VICTIM_AVATAR = "bg-red-50 text-red-600 border border-red-200";
export const SUSPECT_AVATAR = "bg-blue-50 text-blue-700 border border-blue-200";
export const POI_AVATAR = "bg-amber-50 text-amber-800 border border-amber-200";

export function isVictimOrDeceased(role?: string | null, notes?: string | null, classification?: string | null) {
  const n = normalizePersonRole(role || "");
  if (n === "VICTIM" || n === "MISSING_PERSON") return true;
  const blob = `${role || ""} ${notes || ""} ${classification || ""}`.toLowerCase();
  return /\b(deceased|decedent|homicide victim|died|killed)\b/.test(blob);
}

export function entityAvatarClass(role?: string | null, fallback = "bg-slate-50 text-slate-700 border border-slate-200", notes?: string | null, classification?: string | null) {
  if (isVictimOrDeceased(role, notes, classification)) return VICTIM_AVATAR;
  const n = normalizePersonRole(role || "");
  if (n === "MISSING_PERSON") return "bg-amber-50 text-amber-950 border border-amber-400";
  if (n === "SUSPECT") return SUSPECT_AVATAR;
  if (n === "person_of_interest") return POI_AVATAR;
  return fallback;
}

export function entityInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Canonical person-role value stored on the entity record. */
export function normalizePersonRole(role: string) {
  const s = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "missing" || s === "missing_person" || s === "subject") return "MISSING_PERSON";
  if (s === "suspect") return "SUSPECT";
  if (s === "poi" || s === "person_of_interest") return "person_of_interest";
  if (s === "witness") return "WITNESS";
  if (s === "victim") return "VICTIM";
  if (s === "associate") return "ASSOCIATE";
  if (s === "unverified") return "UNVERIFIED";
  return role.trim();
}

/** Sentence-style label for cards, dossier, and tooltips. */
export function formatRoleLabel(role?: string | null) {
  if (!role) return "";
  const n = normalizePersonRole(role);
  if (n === "MISSING_PERSON") return "Missing person";
  if (n === "person_of_interest") return "Person of Interest";
  if (n === "SUSPECT") return "Suspect";
  if (n === "WITNESS") return "Witness";
  if (n === "VICTIM") return "Victim";
  if (n === "ASSOCIATE") return "Associate";
  if (n === "UNVERIFIED") return "Unverified";
  return role.replace(/_/g, " ");
}

/** Compact uppercase label for status toggle buttons. */
export function formatRoleButtonLabel(role: string) {
  const n = normalizePersonRole(role);
  if (n === "MISSING_PERSON") return "MISSING PERSON";
  if (n === "person_of_interest") return "PERSON OF INTEREST";
  return n.toUpperCase();
}

function idleChip(role: string) {
  const n = normalizePersonRole(role);
  if (n === "MISSING_PERSON") return "border-amber-400 bg-amber-50 text-amber-950";
  if (n === "VICTIM") return VICTIM_IDLE;
  if (n === "SUSPECT") return SUSPECT_IDLE;
  return NEUTRAL_IDLE;
}

function selectedChip(role: string) {
  const n = normalizePersonRole(role);
  if (n === "VICTIM") return VICTIM_ON;
  if (n === "SUSPECT") return SUSPECT_ON;
  return NEUTRAL_ON;
}

/** Toggle / selected state for the Status in case row. */
export function roleBadgeClass(role: string, selected?: boolean) {
  if (selected) return `${selectedChip(role)} font-semibold`;
  const n = normalizePersonRole(role);
  if (n === "VICTIM") return `${VICTIM_IDLE} hover:bg-rose-100/70`;
  if (n === "SUSPECT") return `${SUSPECT_IDLE} hover:bg-blue-100/70`;
  return `${NEUTRAL_IDLE} hover:bg-slate-100 hover:text-slate-900`;
}

export function roleDisplayClass(role: string, fallback: string) {
  const n = normalizePersonRole(role);
  if (n === "MISSING_PERSON" || n === "VICTIM" || n === "SUSPECT" || n === "WITNESS" || n === "ASSOCIATE" || n === "UNVERIFIED" || n === "person_of_interest") {
    return idleChip(n);
  }
  return fallback;
}
