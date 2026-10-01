import { normalizePersonRole } from "../utils/roleBadge";

const NON_PERSON_TYPES = new Set([
  "place",
  "location",
  "vehicle",
  "evidence",
  "exhibit",
  "document",
  "phone",
  "digital",
  "attribute",
]);

const ATTRIBUTE_LABEL = /^(physical description|current age|age at disappearance|vehicle driven|height|weight|hair(?: color)?|eyes?(?: color)?|clothing(?: & gear)?|circumstances|distinguishing marks|medical alerts|date of birth|missing from|city and state|scars and marks|scars, tattoos, dental)$/i;

const DOCUMENT_LABEL = /\b(dispatch case|case file|police report|affidavit|press release|incident report)\b/i;

const PLACE_LABEL = /\b(barn|motel|pier|precinct|county|highway|route|dock|warehouse|terminal|airport|bridge)\b/i;

const STATE_LABEL = /^(new hampshire|vermont|maine|massachusetts|arizona|texas|california|florida|new york|north carolina|south carolina|new mexico|rhode island|west virginia|north dakota|south dakota|washington|oregon|pennsylvania|connecticut|new jersey)$/i;

const PERSON_ROLES = new Set([
  "WITNESS",
  "FAMILY",
  "INVESTIGATOR",
  "OFFICER",
  "AGENT",
  "PERSON_OF_INTEREST",
  "SUBJECT",
  "MISSING_PERSON",
  "SUSPECT",
  "ASSOCIATE",
  "VICTIM",
  "UNVERIFIED",
]);

export type PersonRoleTab = "all" | "witness" | "law" | "family" | "poi";

export function looksLikeIndividualName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || ATTRIBUTE_LABEL.test(trimmed) || DOCUMENT_LABEL.test(trimmed) || STATE_LABEL.test(trimmed)) return false;
  if (PLACE_LABEL.test(trimmed) && !/\b(officer|detective|deputy|trooper|sgt|sergeant|agent|chief)\b/i.test(trimmed)) return false;
  const parts = trimmed.split(/\s+/).filter((part) => /[A-Za-z]/.test(part));
  const names = parts.filter((part) => !/^(jr|sr|ii|iii|iv|mr|mrs|ms|dr)\.?$/i.test(part));
  if (names.length < 2) return false;
  return names.every((part) => /^[A-Z][A-Za-z'’.()-]*$/.test(part) || /^[A-Z]\.$/.test(part));
}

export function isSearchNetworkPerson(entity: { type?: string; role?: string; name?: string }) {
  const type = (entity.type || "").trim().toLowerCase();
  if (NON_PERSON_TYPES.has(type)) return false;
  if (type && type !== "person") return false;
  if (!looksLikeIndividualName(entity.name || "")) return false;
  const role = (entity.role || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const normalized = normalizePersonRole(entity.role || "").toUpperCase();
  if (!role) return type === "person";
  return PERSON_ROLES.has(role) || PERSON_ROLES.has(normalized) || type === "person";
}

export function personRoleTab(entity: { role?: string; notes?: string; classification?: string }): Exclude<PersonRoleTab, "all"> | "other" {
  const blob = `${entity.role || ""} ${entity.notes || ""} ${entity.classification || ""}`.toLowerCase();
  const role = normalizePersonRole(entity.role || "").toUpperCase();
  if (/family|liaison|parent|sibling|spouse|mother|father|brother|sister|next of kin/.test(blob) || role === "FAMILY") return "family";
  if (role === "WITNESS" || /witness|reporting party|\bcaller\b/.test(blob)) return "witness";
  if (role === "PERSON_OF_INTEREST" || role === "SUSPECT" || /\bpoi\b|person of interest|suspect/.test(blob)) return "poi";
  if (["INVESTIGATOR", "OFFICER", "AGENT"].includes(role) || /invest|officer|agent|detective|sheriff|trooper|sergeant|deputy|police|law enforcement/.test(blob)) return "law";
  return "other";
}
