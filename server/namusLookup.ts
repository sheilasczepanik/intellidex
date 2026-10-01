import {
  extractNamusId,
  fallbackNamusRecord,
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

function mapNamusJson(data: unknown, mp: string): NamusRecord | null {
  const root = obj(data);
  if (!root) return null;
  const idn = obj(root.subjectIdentification);
  const sight = obj(root.sighting);
  const desc = obj(root.subjectDescription);
  const state = obj(sight?.state);
  const first = str(idn?.firstName);
  const last = str(idn?.lastName);
  const fullName = `${first} ${last}`.trim() || str(root.fullName);
  const city = str(sight?.city);
  const stateName = str(state?.name) || (typeof sight?.state === "string" ? str(sight.state) : "");
  const location = [city, stateName].filter(Boolean).join(", ");
  const lksDate = str(sight?.dateOfLks) || str(sight?.dateOfLastContact);
  if (!fullName && !location && !lksDate) return null;
  return {
    namusId: mp,
    fullName: fullName || `NamUs Subject (${mp})`,
    lksDate,
    lksTime: str(sight?.timeOfLks) || str(sight?.timeOfLastContact),
    location,
    ageAtDisappearance: str(desc?.ageAtDisappearance) || str(desc?.ageLastSeen),
    currentAge: str(desc?.currentMinAge) || str(desc?.currentAge),
    height: str(desc?.height),
    weight: str(desc?.weight),
    hairColor: str(desc?.hairColor) || str(obj(desc?.hair)?.name),
    eyeColor: str(desc?.eyeColor) || str(obj(desc?.eyes)?.name),
    distinguishingMarks: str(desc?.scarsAndMarks) || str(desc?.distinguishingMarks),
    clothing: str(desc?.clothing) || str(desc?.clothingAndAccessories),
    medicalAlerts: str(desc?.medical) || str(desc?.medicalConditions),
    circumstances: str(root.circumstances) || str(sight?.circumstances),
  };
}

async function fetchNamusCase(numericId: string) {
  const url = `https://www.namus.nij.ojp.gov/api/CaseSets/NamUs/MissingPersons/Cases/${numericId}`;
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(6000) : undefined;
  const res = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": BROWSER_UA,
    },
    redirect: "follow",
  });
  if (res.status === 403 || res.status === 401 || res.status === 429) {
    throw new Error(`NamUs gateway blocked the request (${res.status}).`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`NamUs returned HTTP ${res.status}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("NamUs did not return JSON.");
  }
}

export async function lookupNamus(query: string): Promise<NamusLookupResponse> {
  const numericId = namusNumericId(query);
  if (!numericId) {
    return { success: false, error: "Enter a NamUs ID such as MP2316, NamUs #, or a NamUs case URL." };
  }
  const mp = extractNamusId(query)?.mp || `MP${numericId}`;
  try {
    const json = await fetchNamusCase(numericId);
    const record = mapNamusJson(json, mp);
    if (record?.fullName && !record.fullName.startsWith("NamUs Subject")) {
      return namusOk(record, "live");
    }
    return namusOk(fallbackNamusRecord(numericId), "fallback");
  } catch (err) {
    console.error("[namus] lookup failed", err);
    return namusOk(fallbackNamusRecord(numericId), "fallback");
  }
}
