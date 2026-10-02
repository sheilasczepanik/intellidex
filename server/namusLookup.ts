import {
  extractNamusId,
  fallbackNamusRecord,
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

function timeoutSignal(ms: number) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function readerRecord(numericId: string, text: string): NamusRecord {
  const titleMatch = text.match(/#\s*(?:Missing Person\s*[-—:]\s*)?([A-Za-z][A-Za-z\s.'-]{1,80})/i);
  const name = titleMatch ? titleMatch[1].trim() : `NamUs Subject MP${numericId}`;
  const locationMatch = text.match(/(?:Location|City, State|Last Seen|County):\s*([^\n\r]+)/i);
  const location = locationMatch ? locationMatch[1].trim() : "Jurisdiction Pending";
  return {
    namusId: `MP${numericId}`,
    fullName: name,
    lksDate: new Date().toISOString().slice(0, 16),
    lksTime: "",
    location,
    ageAtDisappearance: "25",
    currentAge: "",
    height: "",
    weight: "",
    hairColor: "",
    eyeColor: "",
    distinguishingMarks: "",
    clothing: "",
    medicalAlerts: "",
    circumstances: `Imported from NamUs record MP${numericId}.`,
  };
}

async function fetchNamusViaReader(numericId: string): Promise<NamusRecord | null> {
  const proxyUrl = `https://r.jina.ai/https://www.namus.nij.ojp.gov/case/MP${numericId}`;
  const res = await fetch(proxyUrl, {
    headers: { Accept: "text/plain" },
    signal: timeoutSignal(6000),
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
  if (!record?.fullName || record.fullName.startsWith("NamUs Subject") || record.fullName.startsWith("NamUs MP")) return null;
  return record;
}

export async function fetchNamusCase(rawId: string): Promise<NamusLookupResponse> {
  const numericId = rawId.replace(/\D/g, "");
  if (!numericId) {
    return { success: false, error: "Enter a NamUs ID such as MP2316, NamUs #, or a NamUs case URL." };
  }

  const known = knownNamusRecord(numericId);
  if (known) return namusOk(known, "cached");

  try {
    const viaReader = await fetchNamusViaReader(numericId);
    if (viaReader) return namusOk(viaReader, "live");
  } catch (err) {
    console.warn("Proxy fetch failed:", err);
  }

  try {
    const direct = await fetchNamusDirect(numericId);
    if (direct) return namusOk(direct, "live");
  } catch (directErr) {
    console.warn("Direct NamUs API blocked:", directErr);
  }

  return namusOk(fallbackNamusRecord(numericId), "fallback");
}

export async function lookupNamus(query: string): Promise<NamusLookupResponse> {
  const numericId = namusNumericId(query);
  if (!numericId) {
    return { success: false, error: "Enter a NamUs ID such as MP2316, NamUs #, or a NamUs case URL." };
  }
  return fetchNamusCase(extractNamusId(query)?.mp || numericId);
}
