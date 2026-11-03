import { assistNamusProfile } from "./namusAssist.ts";
import { parseNamusPaste, recordHasFacts, type AssistedNamusRecord } from "../src/lib/namusPaste.ts";
import {
  extractNamusId,
  knownNamusRecord,
  namusNumericId,
  namusOk,
  type NamusLookupResponse,
  type NamusRecord,
} from "../src/lib/namusRecord.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function str(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function named(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return str(value);
  const row = obj(value);
  if (!row) return "";
  return str(row.name) || str(row.description) || str(row.displayName);
}

function heightLabel(value: unknown) {
  const raw = named(value) || str(obj(value)?.inches) || str(obj(value)?.from);
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 36 && n <= 96) {
    return `${Math.floor(n / 12)}'${Math.round(n % 12)}"`;
  }
  return raw;
}

function weightLabel(value: unknown) {
  const raw = named(value) || str(obj(value)?.pounds) || str(obj(value)?.from);
  if (!raw) return "";
  return /lb/i.test(raw) ? raw : `${raw} lbs`;
}

function ageLabel(value: unknown) {
  const row = obj(value);
  return str(row?.years) || str(row?.from) || named(value);
}

function mapNamusJson(data: unknown, mp: string): NamusRecord | null {
  const root = obj(data);
  if (!root) return null;
  const idn = obj(root.subjectIdentification) || obj(root.identification);
  const sight = obj(root.sighting) || obj(root.lastKnownLocation);
  const desc = obj(root.subjectDescription) || obj(root.physicalDescription) || obj(root.description);
  const physical = obj(root.physicalDescription) || desc;
  const clothes = obj(root.clothingAndAccessories);
  const medical = obj(root.medicalInformation);
  const circumstance = obj(root.circumstances);
  const state = obj(sight?.state);
  const first = str(idn?.firstName);
  const last = str(idn?.lastName);
  const fullName = `${first} ${last}`.trim() || str(root.fullName) || str(idn?.name);
  const city = str(sight?.city);
  const stateName = str(state?.name) || (typeof sight?.state === "string" ? str(sight.state) : "");
  const location = [city, stateName].filter(Boolean).join(", ") || str(sight?.address);
  const lksDate = str(sight?.dateOfLks) || str(sight?.dateOfLastContact) || str(sight?.dateLastSeen);
  const sex = named(desc?.sex) || named(idn?.sex) || named(root.sex) || named(desc?.gender);
  if (!fullName && !location && !lksDate && !sex) return null;
  return {
    namusId: mp,
    fullName,
    lksDate,
    lksTime: str(sight?.timeOfLks) || str(sight?.timeOfLastContact),
    location,
    ageAtDisappearance: ageLabel(desc?.ageLastSeen) || ageLabel(desc?.ageAtDisappearance) || str(desc?.age),
    currentAge: ageLabel(desc?.currentMinAge) || ageLabel(desc?.currentAge),
    height: heightLabel(desc?.heightFrom) || heightLabel(desc?.height),
    weight: weightLabel(desc?.weightFrom) || weightLabel(desc?.weight),
    hairColor: named(desc?.hairColor) || named(desc?.hair),
    eyeColor: named(desc?.eyeColor) || named(desc?.eye) || named(desc?.eyes),
    distinguishingMarks: str(physical?.distinguishingMarks) || str(physical?.tattoos) || str(desc?.scarsAndMarks),
    clothing: str(clothes?.clothing) || str(sight?.clothingDescription) || str(desc?.clothing),
    medicalAlerts: str(medical?.conditions) || str(physical?.medical) || str(desc?.medicalConditions),
    circumstances: str(circumstance?.circumstancesOfDisappearance) || str(root.circumstances) || str(sight?.circumstances),
    sex,
  };
}

function timeoutSignal(ms: number) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function usableNamusRecord(record: NamusRecord | null): record is NamusRecord {
  if (!record) return false;
  const name = record.fullName.trim();
  if (/^NamUs (Subject|MP)\b/i.test(name)) return false;
  if (/access denied|just a moment|enable javascript|captcha/i.test(name)) return false;
  const hasName = /[A-Za-z]{2,}/.test(name) && !/^namus$/i.test(name);
  const hasPlace = record.location.trim().length > 2 && !/pending verification|jurisdiction pending/i.test(record.location);
  return hasName || (hasPlace && Boolean(record.lksDate || record.height || record.ageAtDisappearance || record.sex));
}

function recordFromAssisted(assisted: AssistedNamusRecord, numericId: string): NamusRecord | null {
  if (!recordHasFacts(assisted)) return null;
  const digits = assisted.namusId.replace(/\D/g, "") || numericId;
  return {
    namusId: digits ? `MP${digits}` : "",
    fullName: assisted.fullName,
    lksDate: assisted.dateLastSeen,
    lksTime: "",
    location: assisted.location,
    ageAtDisappearance: assisted.ageAtDisappearance,
    currentAge: assisted.currentAge,
    height: assisted.height,
    weight: assisted.weight,
    hairColor: assisted.hair,
    eyeColor: assisted.eyes,
    distinguishingMarks: assisted.distinguishingMarks,
    clothing: assisted.clothing,
    medicalAlerts: assisted.medicalAlerts,
    circumstances: assisted.circumstances || assisted.caseNotes,
    sex: assisted.sex,
  };
}

function readerRecord(numericId: string, text: string): NamusRecord | null {
  const assisted = recordFromAssisted(parseNamusPaste(text, `https://www.namus.gov/MissingPersons/Case#/${numericId}`), numericId);
  return usableNamusRecord(assisted) ? assisted : null;
}

async function fetchNamusViaReader(numericId: string): Promise<NamusRecord | null> {
  const proxyUrl = `https://r.jina.ai/https://www.namus.nij.ojp.gov/case/MP${numericId}`;
  const res = await fetch(proxyUrl, {
    headers: { Accept: "text/plain" },
    signal: timeoutSignal(4000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null;
  return readerRecord(numericId, text);
}

async function fetchNamusDirect(numericId: string): Promise<NamusRecord | null> {
  const url = `https://www.namus.nij.ojp.gov/api/CaseSets/NamUs/MissingPersons/Cases/${numericId}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": BROWSER_UA,
    },
    signal: timeoutSignal(4000),
    redirect: "follow",
  });
  if (!res.ok) return null;
  const json = await res.json() as unknown;
  const mp = `MP${numericId}`;
  const record = mapNamusJson(json, mp);
  return usableNamusRecord(record) ? record : null;
}

export async function fetchNamusCase(rawId: string): Promise<NamusLookupResponse> {
  const numericId = rawId.replace(/\D/g, "");
  if (!numericId) {
    return { success: false, error: "Enter a NamUs ID such as MP2316, NamUs #, or a NamUs case URL." };
  }

  const known = knownNamusRecord(numericId);
  if (known) return namusOk(known, "cached");

  const [direct, viaReader] = await Promise.all([
    fetchNamusDirect(numericId).catch((err) => {
      console.warn("Direct NamUs API blocked:", err);
      return null;
    }),
    fetchNamusViaReader(numericId).catch((err) => {
      console.warn("Proxy fetch failed:", err);
      return null;
    }),
  ]);
  const live = direct || viaReader;
  if (live) return namusOk(live, "live");

  return {
    success: false,
    blocked: true,
    error: "NamUs did not return a readable profile. Paste the profile text to fill this case.",
  };
}

export async function lookupNamus(query: string): Promise<NamusLookupResponse> {
  const numericId = namusNumericId(query);
  if (!numericId) {
    return { success: false, error: "Enter a NamUs ID such as MP2316, NamUs #, or a NamUs case URL." };
  }
  return fetchNamusCase(extractNamusId(query)?.mp || numericId);
}

export async function ingestNamus(input: { query?: string; text?: string; apiKey?: string; model?: string }): Promise<NamusLookupResponse> {
  const text = (input.text || "").trim();
  const query = (input.query || "").trim();
  if (text) {
    const assisted = await assistNamusProfile({ text, url: query, apiKey: input.apiKey || "", model: input.model });
    const numeric = assisted.record.namusId || namusNumericId(query);
    const record = recordFromAssisted(assisted.record, numeric);
    if (!usableNamusRecord(record)) {
      return { success: false, blocked: true, error: "No demographic fields were found in that paste." };
    }
    return {
      ...namusOk(record, "paste"),
      engine: assisted.engine,
      notice: assisted.engine === "gpt-4o" ? "Structured with GPT-4o." : "Structured from the pasted text on this machine.",
    };
  }
  return lookupNamus(query);
}
