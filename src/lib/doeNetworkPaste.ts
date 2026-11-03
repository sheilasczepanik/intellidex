import { parseDoeNetworkId } from "./doeNetworkId";
import { lksFromNamusDate, normalizeDate } from "./namusPaste";

export type AssistedDoeRecord = {
  fullName: string;
  doeNetworkId: string;
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
};

const FIELDS: (keyof AssistedDoeRecord)[] = [
  "fullName", "doeNetworkId", "sex", "race", "ageAtDisappearance", "currentAge", "dateOfBirth",
  "height", "weight", "hair", "eyes", "distinguishingMarks", "clothing", "medicalAlerts",
  "dateLastSeen", "location", "circumstances", "caseNotes",
];

export function emptyDoeRecord(): AssistedDoeRecord {
  return {
    fullName: "", doeNetworkId: "", sex: "", race: "", ageAtDisappearance: "", currentAge: "",
    dateOfBirth: "", height: "", weight: "", hair: "", eyes: "", distinguishingMarks: "",
    clothing: "", medicalAlerts: "", dateLastSeen: "", location: "", circumstances: "", caseNotes: "",
  };
}

export function doeRecordHasFacts(record: AssistedDoeRecord) {
  return FIELDS.some((key) => key !== "doeNetworkId" && record[key].trim().length > 0);
}

export function doeIdFromText(raw: string) {
  const tokens = raw.toUpperCase().match(/\d{2,4}[A-Z]{4}/g) || [];
  for (const token of tokens) {
    const parsed = parseDoeNetworkId(token);
    if (parsed) return parsed.id;
  }
  return "";
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

function sexFromStatus(id: string) {
  const parsed = parseDoeNetworkId(id);
  if (!parsed) return "";
  if (parsed.statusCode.endsWith("M")) return "Male";
  if (parsed.statusCode.endsWith("F")) return "Female";
  return "";
}

function splitBuild(raw: string) {
  const value = raw.trim();
  const match = value.match(/^(.+?)(?:\s*[/\-–]\s*|\s{2,})(\d{2,3}\s*lbs?)$/i);
  if (!match) return { height: value, weight: "" };
  return { height: match[1].trim(), weight: /lbs?/i.test(match[2]) ? match[2] : `${match[2]} lbs` };
}

export function coerceDoeRecord(raw: unknown): AssistedDoeRecord {
  const record = emptyDoeRecord();
  if (!raw || typeof raw !== "object") return record;
  const source = raw as Record<string, unknown>;
  for (const key of FIELDS) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") {
      record[key] = clip(String(value), key === "circumstances" || key === "caseNotes" ? 4000 : 400);
    }
  }
  record.doeNetworkId = doeIdFromText(record.doeNetworkId) || doeIdFromText(record.fullName);
  record.dateOfBirth = normalizeDate(record.dateOfBirth);
  record.dateLastSeen = normalizeDate(record.dateLastSeen);
  record.ageAtDisappearance = record.ageAtDisappearance.replace(/\s*years?\b.*/i, "");
  if (!record.sex) record.sex = sexFromStatus(record.doeNetworkId);
  return record;
}

export function mergeDoeRecords(primary: AssistedDoeRecord, fallback: AssistedDoeRecord) {
  const next = { ...primary };
  for (const key of FIELDS) {
    if (!next[key].trim() && fallback[key].trim()) next[key] = fallback[key];
  }
  return next;
}

export function parseDoePaste(text: string, url = ""): AssistedDoeRecord {
  const record = emptyDoeRecord();
  const body = text.replace(/\r/g, "");
  const heading = body.match(/^(?:Missing|Unidentified|Case File)\s*\n+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4})\s*$/m);
  record.fullName = clip(field(body, ["Legal name", "Full name", "Name", "Victim"]) || heading?.[1] || "", 160);
  record.doeNetworkId = doeIdFromText(field(body, ["Doe Network ID", "Doe Network case", "Case file", "Case number", "Case"])) || doeIdFromText(body) || doeIdFromText(url);
  record.sex = clip(field(body, ["Biological sex", "Sex", "Gender"]), 40) || sexFromStatus(record.doeNetworkId);
  record.race = clip(field(body, ["Race \\/ ethnicity", "Race", "Ethnicity"]), 80);
  record.ageAtDisappearance = clip(field(body, ["Age at disappearance", "Age"]).replace(/\s*years?\b.*/i, ""), 20);
  record.dateOfBirth = normalizeDate(field(body, ["Date of birth", "DOB"]));
  const build = field(body, ["Height and weight", "Height \\/ weight"]);
  const split = build ? splitBuild(build) : { height: "", weight: "" };
  record.height = clip(field(body, ["Height"]) || split.height, 40);
  record.weight = clip(field(body, ["Weight"]) || split.weight, 40);
  record.hair = clip(field(body, ["Hair color", "Hair"]), 40);
  record.eyes = clip(field(body, ["Eye color", "Eyes"]), 40);
  record.distinguishingMarks = clip(field(body, ["Distinguishing characteristics", "Distinguishing marks", "Scars and marks", "Scars"]), 400);
  record.clothing = clip(field(body, ["Clothing\\/jewelry", "Clothing and jewelry", "Clothing last seen", "Clothing"]), 400);
  record.medicalAlerts = clip(field(body, ["Medical alerts", "Medical conditions", "Medical"]), 400);
  record.dateLastSeen = normalizeDate(field(body, ["Missing since", "Date missing", "Date of last contact", "Date last seen", "Last seen"]));
  const city = field(body, ["City"]);
  const state = field(body, ["State"]);
  const location = field(body, ["Location \\(last seen\\)", "Last known location", "Location"]);
  record.location = clip(location || [city, state].filter(Boolean).join(", "), 180);
  record.circumstances = clip(field(body, ["Circumstances of disappearance", "Circumstances", "Description"]), 4000);
  record.caseNotes = clip(field(body, ["Investigative notes", "Case notes", "Notes"]), 4000);
  return record;
}

export function lksFromDoeDate(raw: string) {
  return lksFromNamusDate(raw);
}
