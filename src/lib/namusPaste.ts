import { extractNamusId } from "./namusRecord";

export type AssistedNamusRecord = {
  fullName: string;
  namusId: string;
  sex: string;
  race: string;
  ageAtDisappearance: string;
  currentAge: string;
  dateOfBirth: string;
  height: string;
  weight: string;
  hair: string;
  eyes: string;
  distinguishingMarks: string;
  clothing: string;
  medicalAlerts: string;
  dateLastSeen: string;
  location: string;
  circumstances: string;
  caseNotes: string;
  agencyCaseNumber: string;
};

const FIELDS: (keyof AssistedNamusRecord)[] = [
  "fullName", "namusId", "sex", "race", "ageAtDisappearance", "currentAge", "dateOfBirth",
  "height", "weight", "hair", "eyes", "distinguishingMarks", "clothing", "medicalAlerts",
  "dateLastSeen", "location", "circumstances", "caseNotes", "agencyCaseNumber",
];

export function emptyNamusRecord(): AssistedNamusRecord {
  return {
    fullName: "", namusId: "", sex: "", race: "", ageAtDisappearance: "", currentAge: "",
    dateOfBirth: "", height: "", weight: "", hair: "", eyes: "", distinguishingMarks: "",
    clothing: "", medicalAlerts: "", dateLastSeen: "", location: "", circumstances: "",
    caseNotes: "", agencyCaseNumber: "",
  };
}

export function recordHasFacts(record: AssistedNamusRecord) {
  return FIELDS.some((key) => record[key].trim().length > 0);
}

export function namusIdFromUrl(url: string) {
  return extractNamusId(url)?.numeric || "";
}

function labeled(text: string, labels: string[]) {
  const pattern = new RegExp(`^(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)$`, "im");
  return pattern.exec(text)?.[1]?.trim() || "";
}

function following(text: string, labels: string[]) {
  const pattern = new RegExp(`^(?:${labels.join("|")})\\s*$\\r?\\n+([^\\n]+)`, "im");
  return pattern.exec(text)?.[1]?.trim() || "";
}

function field(text: string, labels: string[]) {
  return labeled(text, labels) || following(text, labels);
}

function clip(value: string, max = 2000) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function coerceNamusRecord(raw: unknown): AssistedNamusRecord {
  const record = emptyNamusRecord();
  if (!raw || typeof raw !== "object") return record;
  const source = raw as Record<string, unknown>;
  for (const key of FIELDS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") record[key] = clip(String(value), key === "circumstances" || key === "caseNotes" ? 4000 : 400);
  }
  record.namusId = record.namusId.replace(/\D/g, "").slice(0, 8);
  record.dateOfBirth = normalizeDate(record.dateOfBirth);
  record.dateLastSeen = normalizeDate(record.dateLastSeen);
  return record;
}

export function mergeNamusRecords(primary: AssistedNamusRecord, fallback: AssistedNamusRecord) {
  const next = { ...primary };
  for (const key of FIELDS) {
    if (!next[key].trim() && fallback[key].trim()) next[key] = fallback[key];
  }
  return next;
}

export function parseNamusPaste(text: string, url = ""): AssistedNamusRecord {
  const record = emptyNamusRecord();
  const body = text.replace(/\r/g, "");
  const heading = body.match(/^(?:Missing Person|Unidentified Person|Unclaimed Person)\s*\n+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4})\s*$/m);
  record.fullName = clip(field(body, ["Legal name", "Full name", "Name"]) || heading?.[1] || "", 160);
  const idLine = field(body, ["NamUs case number", "NamUs #", "NamUs number", "NamUs ID", "Case number"]);
  const idMatch = body.match(/\bNamUs\s*(?:#|number|ID)?\s*(?:MP|UP|UF|UM)?\s*#?\s*(\d{2,8})\b/i) || idLine.match(/(\d{2,8})/);
  record.namusId = idMatch?.[1] || namusIdFromUrl(url);
  record.sex = clip(field(body, ["Biological sex", "Sex", "Gender"]), 40);
  record.race = clip(field(body, ["Race \\/ ethnicity", "Race", "Ethnicity"]), 80);
  record.ageAtDisappearance = clip(field(body, ["Age at disappearance", "Age last seen", "Age"]).replace(/\s*years?\b.*/i, ""), 20);
  record.currentAge = clip(field(body, ["Current age", "Current estimated age"]).replace(/\s*years?\b.*/i, ""), 20);
  record.dateOfBirth = normalizeDate(field(body, ["Date of birth", "DOB"]));
  record.height = clip(field(body, ["Height"]), 40);
  record.weight = clip(field(body, ["Weight"]), 40);
  record.hair = clip(field(body, ["Hair color", "Hair"]), 40);
  record.eyes = clip(field(body, ["Eye color", "Eyes"]), 40);
  record.distinguishingMarks = clip(field(body, ["Distinguishing marks", "Scars and marks", "Scars", "Tattoos"]), 400);
  record.clothing = clip(field(body, ["Clothing and accessories", "Clothing last seen", "Clothing"]), 400);
  record.medicalAlerts = clip(field(body, ["Medical alerts", "Medical conditions", "Medical"]), 400);
  record.dateLastSeen = normalizeDate(field(body, ["Date of last contact", "Date last seen", "Last seen", "DLC"]));
  const city = field(body, ["City"]);
  const state = field(body, ["State"]);
  const location = field(body, ["Last known location", "City, State", "Location"]);
  record.location = clip(location || [city, state].filter(Boolean).join(", "), 180);
  record.circumstances = clip(field(body, ["Circumstances of disappearance", "Circumstances", "Description"]), 4000);
  record.caseNotes = clip(field(body, ["Investigative notes", "Case notes", "Notes"]), 4000);
  record.agencyCaseNumber = clip(field(body, ["Agency case number", "Investigating agency case", "Police case"]), 80);
  return record;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

export function normalizeDate(raw: string) {
  const value = raw.trim();
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const named = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  const month = named ? MONTHS[named[1].toLowerCase()] : "";
  if (named && month) return `${named[3]}-${month}-${named[2].padStart(2, "0")}`;
  return clip(value, 40);
}

export function lksFromNamusDate(raw: string) {
  const date = normalizeDate(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T12:00`;
  return "";
}
