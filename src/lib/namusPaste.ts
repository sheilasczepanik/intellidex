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
  const match = url.match(/\/(?:missing|unidentified|unclaimed)persons\/(\d+)/i)
    || url.match(/\b(?:MP|UP|UF|UM)[-# ]?(\d{2,8})\b/i);
  return match?.[1] || "";
}

function labeled(text: string, labels: string[]) {
  const pattern = new RegExp(`^(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)$`, "im");
  return pattern.exec(text)?.[1]?.trim() || "";
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
  record.fullName = clip(labeled(body, ["Legal name", "Full name", "Name", "Missing person"]), 160);
  const idLine = labeled(body, ["NamUs case number", "NamUs #", "NamUs ID", "Case number"]);
  const idMatch = body.match(/\bNamUs\s*(?:#|number|ID)?\s*(?:MP|UP|UF|UM)?\s*#?\s*(\d{2,8})\b/i) || idLine.match(/(\d{2,8})/);
  record.namusId = idMatch?.[1] || namusIdFromUrl(url);
  record.sex = clip(labeled(body, ["Sex", "Biological sex", "Gender"]), 40);
  record.race = clip(labeled(body, ["Race", "Race \\/ ethnicity", "Ethnicity"]), 80);
  record.ageAtDisappearance = clip(labeled(body, ["Age at disappearance", "Age last seen", "Age"]), 20);
  record.currentAge = clip(labeled(body, ["Current age", "Current estimated age"]), 20);
  record.dateOfBirth = normalizeDate(labeled(body, ["Date of birth", "DOB"]));
  record.height = clip(labeled(body, ["Height"]), 40);
  record.weight = clip(labeled(body, ["Weight"]), 40);
  record.hair = clip(labeled(body, ["Hair color", "Hair"]), 40);
  record.eyes = clip(labeled(body, ["Eye color", "Eyes"]), 40);
  record.distinguishingMarks = clip(labeled(body, ["Distinguishing marks", "Scars and marks", "Scars", "Tattoos"]), 400);
  record.clothing = clip(labeled(body, ["Clothing", "Clothing and accessories", "Clothing last seen"]), 400);
  record.medicalAlerts = clip(labeled(body, ["Medical alerts", "Medical", "Circumstances of disappearance medical"]), 400);
  record.dateLastSeen = normalizeDate(labeled(body, ["Date of last contact", "Date last seen", "Last seen", "DLC"]));
  const city = labeled(body, ["City"]);
  const state = labeled(body, ["State"]);
  const location = labeled(body, ["Location", "Last known location", "City, State"]);
  record.location = clip(location || [city, state].filter(Boolean).join(", "), 180);
  record.circumstances = clip(labeled(body, ["Circumstances", "Circumstances of disappearance", "Description"]), 4000);
  record.caseNotes = clip(labeled(body, ["Case notes", "Investigative notes", "Notes"]), 4000);
  record.agencyCaseNumber = clip(labeled(body, ["Agency case number", "Investigating agency case", "Police case"]), 80);
  return record;
}

export function normalizeDate(raw: string) {
  const value = raw.trim();
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return clip(value, 40);
}

export function lksFromNamusDate(raw: string) {
  const date = normalizeDate(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T12:00`;
  return "";
}
