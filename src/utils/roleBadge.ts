export const PERSON_ROLE_VALUES = [
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

/** Canonical person-role value stored on the entity record. */
export function normalizePersonRole(role: string) {
  const s = role.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "subject" || s === "suspect") return "SUSPECT";
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
  if (n === "person_of_interest") return "PERSON OF INTEREST";
  return n.toUpperCase();
}

function idleChip(role: string) {
  const n = normalizePersonRole(role);
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
  if (n === "VICTIM" || n === "SUSPECT" || n === "WITNESS" || n === "ASSOCIATE" || n === "UNVERIFIED" || n === "person_of_interest") {
    return idleChip(n);
  }
  return fallback;
}
