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

export type NamusLookupResponse = {
  record?: NamusRecord;
  source?: "live" | "cached";
  error?: string;
};

/** Public NamUs MP#54 — Maura Murray (Haverhill, NH, 9 Feb 2004). */
export const NAMUS_MP54: NamusRecord = {
  namusId: "MP54",
  fullName: "Maura Murray",
  lksDate: "2004-02-09",
  lksTime: "19:27",
  location: "Haverhill, Grafton County, NH",
  ageAtDisappearance: "21",
  currentAge: "43",
  height: "5'3\"",
  weight: "120 lbs",
  hairColor: "Brown",
  eyeColor: "Blue",
  distinguishingMarks: "Scar on right knee",
  clothing: "Dark coat, jeans",
  medicalAlerts: "",
  circumstances:
    "Last seen after a single-vehicle crash on Route 112 in Haverhill, New Hampshire. Left the University of Massachusetts Amherst campus earlier that day. NamUs MP#54.",
};

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
