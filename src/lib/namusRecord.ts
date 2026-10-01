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
    notice: source === "fallback" ? NAMUS_GATEWAY_NOTICE : undefined,
  };
}

export function namusNumericId(raw: string) {
  const parsed = extractNamusId(raw);
  if (parsed?.numeric) return parsed.numeric;
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits || "";
}

function localToday() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Clean starter record when the NamUs gateway is unreachable. */
export function fallbackNamusRecord(numericId: string): NamusRecord {
  const numeric = numericId.replace(/\D/g, "") || numericId;
  return {
    namusId: `MP${numeric}`,
    fullName: `NamUs Subject (MP${numeric})`,
    lksDate: localToday(),
    lksTime: "12:00",
    location: "Pending jurisdiction confirmation",
    ageAtDisappearance: "",
    currentAge: "",
    height: "",
    weight: "",
    hairColor: "",
    eyeColor: "",
    distinguishingMarks: "",
    clothing: "",
    medicalAlerts: "",
    circumstances: "",
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
