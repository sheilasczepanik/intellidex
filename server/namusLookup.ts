import { assertPublicHttpUrl, ScrapeHttpError } from "./scrapeUrl.ts";
import {
  extractNamusId,
  NAMUS_MP54,
  namusOk,
  type NamusLookupResponse,
  type NamusRecord,
} from "../src/lib/namusRecord.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NAMUS_HOSTS = new Set([
  "namus.gov",
  "www.namus.gov",
  "namus.nij.ojp.gov",
  "www.namus.nij.ojp.gov",
]);

function decode(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labeled(html: string, labels: string[]) {
  for (const label of labels) {
    const re = new RegExp(
      `${label}\\s*[:<][^<]{0,40}</[^>]+>\\s*([^<]{1,240})|${label}\\s*[:–-]\\s*([^<\\n]{1,240})`,
      "i",
    );
    const m = html.match(re);
    const value = decode(m?.[1] || m?.[2] || "");
    if (value && value.length < 400) return value;
  }
  return "";
}

function parseNamusHtml(html: string, mp: string): Partial<NamusRecord> {
  const first = labeled(html, ["First Name", "First name"]);
  const last = labeled(html, ["Last Name", "Last name"]);
  const fullFromParts = [first, last].filter(Boolean).join(" ");
  const title = html.match(/<h1[^>]*>([\s\S]{3,120})<\/h1>/i);
  return {
    namusId: mp,
    fullName: fullFromParts || decode(title?.[1] || ""),
    lksDate: labeled(html, ["Date Last Seen", "Last Seen", "Missing Since", "Date of Last Contact"]),
    lksTime: labeled(html, ["Time Last Seen", "Time of Last Contact"]),
    location: labeled(html, ["Last Known Location", "City and State", "Missing From", "Location"]),
    ageAtDisappearance: labeled(html, ["Age", "Age at Disappearance", "Missing Age"]),
    currentAge: labeled(html, ["Current Age", "Age Now"]),
    height: labeled(html, ["Height"]),
    weight: labeled(html, ["Weight"]),
    hairColor: labeled(html, ["Hair Color", "Hair"]),
    eyeColor: labeled(html, ["Eye Color", "Eyes"]),
    distinguishingMarks: labeled(html, ["Scars and Marks", "Distinguishing Marks", "Physical Features"]),
    clothing: labeled(html, ["Clothing", "Clothing and Accessories", "Clothing Worn"]),
    medicalAlerts: labeled(html, ["Medical", "Medical Conditions", "Circumstances Medical"]),
    circumstances: labeled(html, ["Circumstances", "Case Circumstances", "Narrative"]),
  };
}

function isComplete(row: Partial<NamusRecord>) {
  return Boolean(row.fullName?.trim() && (row.location?.trim() || row.lksDate?.trim()));
}

function mergeRecord(base: NamusRecord, patch: Partial<NamusRecord>): NamusRecord {
  const next = { ...base };
  for (const key of Object.keys(base) as (keyof NamusRecord)[]) {
    const value = (patch[key] || "").trim();
    if (value) (next[key] as string) = value;
  }
  return next;
}

function emptyRecord(mp: string): NamusRecord {
  return {
    namusId: mp,
    fullName: "",
    lksDate: "",
    lksTime: "",
    location: "",
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

function mockFor(numeric: string): NamusRecord | null {
  if (numeric === "54") return { ...NAMUS_MP54 };
  return null;
}

function namusUrls(numeric: string) {
  return [
    `https://www.namus.nij.ojp.gov/missing-persons/case-details/${numeric}`,
    `https://www.namus.gov/MissingPersons/Cases/${numeric}`,
  ];
}

async function fetchPage(url: string) {
  const parsed = assertPublicHttpUrl(url);
  if (!NAMUS_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new ScrapeHttpError(400, "Only public NamUs case pages can be fetched.");
  }
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(6000) : undefined;
  const res = await fetch(parsed.toString(), {
    signal,
    headers: {
      Accept: "application/json, text/html, */*",
      "User-Agent": BROWSER_UA,
    },
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok) throw new ScrapeHttpError(res.status, `NamUs returned HTTP ${res.status}`);
  return text;
}

export async function lookupNamus(query: string): Promise<NamusLookupResponse> {
  const parsed = extractNamusId(query);
  if (!parsed) {
    return { success: false, error: "Enter a NamUs ID such as MP1028, NamUs #, or a NamUs case URL." };
  }
  const fixture = mockFor(parsed.numeric);

  try {
    let html = "";
    for (const url of namusUrls(parsed.numeric)) {
      try {
        html = await fetchPage(url);
        if (html && html.length > 200) break;
      } catch (err) {
        console.error("[namus] fetch failed", url, err);
      }
    }
    const live = html ? parseNamusHtml(html, parsed.mp) : {};
    if (isComplete(live)) {
      const record = mergeRecord(fixture ?? emptyRecord(parsed.mp), live);
      return namusOk(record, "live");
    }
    if (fixture) return namusOk(fixture, "cached");
    return { success: false, error: `No NamUs record found for ${parsed.mp}.` };
  } catch (err) {
    console.error("[namus] lookup failed", err);
    if (fixture) return namusOk(fixture, "cached");
    return { success: false, error: `NamUs lookup failed for ${parsed.mp}.` };
  }
}
