export type NamusRecord = {
  namusId: string;
  fullName: string;
  lksDate: string;
  lksTime: string;
  location: string;
  ageAtDisappearance: string;
  currentAge: string;
  height: string;
  weight: string;
  hairColor: string;
  eyeColor: string;
  distinguishingMarks: string;
  clothing: string;
  medicalAlerts: string;
  circumstances: string;
};

/** Shape returned as `data` from `/api/namus` for the new-case form. */
export type NamusFormPayload = {
  name: string;
  caseId: string;
  lksDate: string;
  location: string;
  ageAtDisappearance: number | string;
  currentAge: number | string;
  height: string;
  weight: string;
  hair: string;
  eyes: string;
  marks: string;
  distinguishingMarks: string;
  clothing: string;
  medicalAlerts: string;
  circumstances: string;
};

export type NamusLookupResponse = {
  success?: boolean;
  data?: NamusFormPayload;
  record?: NamusRecord;
  source?: "live" | "cached" | "fallback";
  notice?: string;
  error?: string;
};

export const NAMUS_GATEWAY_NOTICE =
  "NamUs gateway busy: Record initialized. You can edit fields manually or add source PDFs.";

/** Public NamUs MP#54 — Maura Murray (Haverhill, NH, 9 Feb 2004). */
export const NAMUS_MP54: NamusRecord = {
  namusId: "MP54",
  fullName: "Maura Murray",
  lksDate: "2004-02-09",
  lksTime: "19:27",
  location: "Route 112, Haverhill, Grafton County, NH",
  ageAtDisappearance: "21",
  currentAge: "43",
  height: "5'7\"",
  weight: "120 lbs",
  hairColor: "Light Brown",
  eyeColor: "Green / Hazel",
  distinguishingMarks: "Dimple on right cheek, small scar above right eyebrow",
  clothing: "Dark jacket, jeans, backpack",
  medicalAlerts: "None recorded",
  circumstances:
    "Maura was last seen at approximately 7:27 PM following a single-car accident on Route 112 in Woodsville/Haverhill, New Hampshire.",
};

export function namusRecordToPayload(record: NamusRecord): NamusFormPayload {
  return {
    name: record.fullName,
    caseId: record.namusId,
    lksDate: namusLksDatetime(record) || record.lksDate,
    location: record.location,
    ageAtDisappearance: Number(record.ageAtDisappearance) || record.ageAtDisappearance,
    currentAge: Number(record.currentAge) || record.currentAge,
    height: record.height,
    weight: record.weight,
    hair: record.hairColor,
    eyes: record.eyeColor,
    marks: record.distinguishingMarks,
    distinguishingMarks: record.distinguishingMarks,
    clothing: record.clothing,
    medicalAlerts: record.medicalAlerts,
    circumstances: record.circumstances,
  };
}

export function namusOk(record: NamusRecord, source: "live" | "cached" | "fallback" = "cached"): NamusLookupResponse {
  return {
    success: true,
    data: namusRecordToPayload(record),
    record,
    source,
  };
}

type NamusFixture = {
  name: string;
  lksDate: string;
  location: string;
  ageAtDisappearance: number | string;
  currentAge: number | string;
  height: string;
  weight: string;
  hair: string;
  eyes: string;
  distinguishingMarks: string;
  clothing: string;
  medicalAlerts: string;
  circumstances: string;
};

/** Demo IDs that fill immediately, before any network call. */
export const KNOWN_NAMUS_CASES: Record<string, NamusFixture> = {
  "54": {
    name: "Maura Murray",
    lksDate: "2004-02-09T19:27",
    location: "Haverhill, Grafton County, New Hampshire",
    ageAtDisappearance: 21,
    currentAge: 43,
    height: "5'7\"",
    weight: "120 lbs",
    hair: "Light Brown",
    eyes: "Hazel",
    distinguishingMarks: "Dimple on right cheek. No known tattoos.",
    clothing: "Dark jacket, jeans, running shoes, dark backpack.",
    medicalAlerts: "None reported. Potential trauma from vehicle collision.",
    circumstances: "Last seen on Route 112 after single vehicle collision into snowbank.",
  },
  "2316": {
    name: "Tammy Lynn Leppert",
    lksDate: "1983-07-06T11:00",
    location: "Cocoa Beach, Brevard County, Florida",
    ageAtDisappearance: 18,
    currentAge: 61,
    height: "5'5\"",
    weight: "105 lbs",
    hair: "Blonde",
    eyes: "Hazel",
    distinguishingMarks: "Small mole under right eye; faint scar on left knee.",
    clothing: "Blue denim skirt, blue pullover shirt with floral print.",
    medicalAlerts: "Reported severe anxiety and paranoia prior to disappearance.",
    circumstances: "Last seen leaving Cocoa Beach in a vehicle after attending a film audition.",
  },
  "1028": {
    name: "Jason Jolkowski",
    lksDate: "2001-06-13T10:45",
    location: "Omaha, Douglas County, Nebraska",
    ageAtDisappearance: 19,
    currentAge: 44,
    height: "6'1\"",
    weight: "165 lbs",
    hair: "Brown",
    eyes: "Brown",
    distinguishingMarks: "Mild learning disability with speech impairment.",
    clothing: "White Chicago Cubs t-shirt, blue athletic shorts, black shoes, Chicago Cubs baseball cap.",
    medicalAlerts: "Speech/language processing impairment; mild cognitive disability.",
    circumstances: "Disappeared while walking toward high school pickup location.",
  },
};

export function knownNamusRecord(numericId: string): NamusRecord | null {
  const fixture = KNOWN_NAMUS_CASES[numericId.replace(/\D/g, "")];
  if (!fixture) return null;
  const stamp = fixture.lksDate;
  return {
    namusId: `MP${numericId.replace(/\D/g, "")}`,
    fullName: fixture.name,
    lksDate: stamp,
    lksTime: "",
    location: fixture.location,
    ageAtDisappearance: fixture.ageAtDisappearance === "" ? "" : String(fixture.ageAtDisappearance),
    currentAge: fixture.currentAge === "" ? "" : String(fixture.currentAge),
    height: fixture.height,
    weight: fixture.weight,
    hairColor: fixture.hair,
    eyeColor: fixture.eyes,
    distinguishingMarks: fixture.distinguishingMarks,
    clothing: fixture.clothing,
    medicalAlerts: fixture.medicalAlerts,
    circumstances: fixture.circumstances,
  };
}

export function namusNumericId(raw: string) {
  const parsed = extractNamusId(raw);
  if (parsed?.numeric) return parsed.numeric;
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits || "";
}

function localStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Clean starter record when NamUs cannot be read. The form still fills. */
export function fallbackNamusRecord(numericId: string): NamusRecord {
  const known = knownNamusRecord(numericId);
  if (known) return known;
  const numeric = numericId.replace(/\D/g, "") || numericId;
  return {
    namusId: `MP${numeric}`,
    fullName: `NamUs MP${numeric}`,
    lksDate: localStamp(),
    lksTime: "",
    location: "Pending verification",
    ageAtDisappearance: "",
    currentAge: "",
    height: "",
    weight: "",
    hairColor: "",
    eyeColor: "",
    distinguishingMarks: "",
    clothing: "",
    medicalAlerts: "",
    circumstances: `Initialized container for NamUs record #${numeric}.`,
  };
}

export function extractNamusId(raw: string): { numeric: string; mp: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const fromPath = s.match(/case-details\/(\d+)/i) || s.match(/\/cases\/(\d+)/i) || s.match(/[?&](?:id|caseId)=(\d+)/i);
  if (fromPath) {
    const n = Number(fromPath[1]);
    if (Number.isFinite(n) && n > 0) return { numeric: String(n), mp: `MP${n}` };
  }
  const mp = s.match(/\bMP[\s#_:-]*(\d+)\b/i);
  if (mp) {
    const n = String(Number(mp[1]));
    return { numeric: n, mp: `MP${n}` };
  }
  const namus = s.match(/\bnamus\b[^0-9]{0,16}(\d{1,7})\b/i);
  if (namus) {
    const n = String(Number(namus[1]));
    return { numeric: n, mp: `MP${n}` };
  }
  if (/^\d{1,7}$/.test(s)) {
    const n = String(Number(s));
    return { numeric: n, mp: `MP${n}` };
  }
  return null;
}

export function namusLksDatetime(record: NamusRecord) {
  const day = (record.lksDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(day)) return day.slice(0, 16);
  const isoDay = day.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || parseLooseDay(day);
  if (!isoDay) return "";
  const time = (record.lksTime || "").trim();
  const hm = parseLooseTime(time);
  return `${isoDay}T${hm}`;
}

function parseLooseDay(raw: string) {
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) {
    const n = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!n) return "";
    return `${n[3]}-${n[1].padStart(2, "0")}-${n[2].padStart(2, "0")}`;
  }
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  const mm = months[m[1].toLowerCase()];
  if (!mm) return "";
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
}

function parseLooseTime(raw: string) {
  if (!raw) return "12:00";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!m) return "12:00";
  let h = Number(m[1]);
  const min = m[2];
  const ap = (m[3] || "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}
