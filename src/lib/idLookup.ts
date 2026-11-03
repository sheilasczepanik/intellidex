import { db, type CaseRecord, type CaseStatus, type SubjectProfile } from "../db/schema";
import { parseDoeNetworkId, type DoeNetworkId } from "./doeNetworkId";
import { formatAlertLabel } from "./missingPerson";
import { knownDoeRecord } from "./doeNetworkRecord";
import { knownNamusRecord, namusLksDatetime } from "./namusRecord";

export type IdKind = "doe" | "namus";

export type ParsedOfficialId = {
  kind: IdKind;
  official: string;
  doe?: DoeNetworkId;
  prefix?: "MP" | "UP";
  numeric?: string;
};

export type IdLink = { label: string; href: string };

export type IdProfile = {
  officialId: string;
  kind: IdKind;
  name: string;
  status: string;
  statusLabel: string;
  date: string;
  location: string;
  sex: string;
  age: string;
  height: string;
  weight: string;
  hair: string;
  eyes: string;
  circumstances: string;
  links: IdLink[];
  source: "case" | "fixture";
};

export type IdCaseDraft = {
  subjectName: string;
  summary: string;
  status: CaseStatus;
  jurisdiction: string;
  fileIdentifier: string;
  doeNetworkId: string;
  lksAt: string;
  profile: SubjectProfile;
};

export type IdPrefill = {
  officialId: string;
  fileIdentifier: string;
  doeNetworkId: string;
};

export type IdLookupResult =
  | { state: "invalid" }
  | { state: "case"; caseId: string; profile: IdProfile }
  | { state: "fixture"; profile: IdProfile; draft: IdCaseDraft }
  | { state: "missing"; prefill: IdPrefill };

const NAMUS_TOKEN = /^(?:MP|UP)\s*#?\s*[-:]?\s*(\d{1,8})$/i;

export function parseOfficialId(raw: string): ParsedOfficialId | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const doe = parseDoeNetworkId(trimmed);
  if (doe && normalizeCompact(trimmed) === doe.id) return { kind: "doe", official: doe.id, doe };

  const compact = trimmed.toUpperCase().replace(/\s+/g, " ");
  const token = compact.match(NAMUS_TOKEN);
  if (token) {
    const prefix = compact.startsWith("UP") ? "UP" : "MP";
    const numeric = String(Number(token[1]));
    if (!numeric || numeric === "0") return null;
    return { kind: "namus", official: `${prefix}${numeric}`, prefix, numeric };
  }

  if (!/namus/i.test(trimmed)) return null;
  const numericMatch = trimmed.match(/(\d{1,8})(?!.*\d)/);
  if (!numericMatch) return null;
  const numeric = String(Number(numericMatch[1]));
  if (!numeric || numeric === "0") return null;
  const unidentified = /unidentified/i.test(trimmed) || /\bUP\b/i.test(trimmed);
  const prefix = unidentified ? "UP" : "MP";
  return { kind: "namus", official: `${prefix}${numeric}`, prefix, numeric };
}

function normalizeCompact(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function namusHref(prefix: "MP" | "UP", numeric: string) {
  const section = prefix === "UP" ? "UnidentifiedPersons" : "MissingPersons";
  return `https://www.namus.gov/${section}/Case#/${numeric}`;
}

function doeHref(doe: DoeNetworkId) {
  return `https://www.doenetwork.org/cases/${doe.state.toLowerCase()}/${doe.id.toLowerCase()}.html`;
}

function linksFor(parsed: ParsedOfficialId, extra: string[] = []): IdLink[] {
  const links: IdLink[] = [];
  if (parsed.kind === "doe" && parsed.doe) {
    links.push({ label: parsed.official, href: doeHref(parsed.doe) });
  }
  if (parsed.kind === "namus" && parsed.prefix && parsed.numeric) {
    links.push({ label: parsed.official, href: namusHref(parsed.prefix, parsed.numeric) });
  }
  for (const href of extra) {
    if (!/^https?:\/\//i.test(href)) continue;
    if (links.some((link) => link.href === href)) continue;
    links.push({ label: href.replace(/^https?:\/\//, ""), href });
  }
  return links;
}

function namusFileMatches(file: string, prefix: "MP" | "UP", numeric: string) {
  const compact = normalizeCompact(file);
  if (compact === `${prefix}${numeric}`) return true;
  const labeled = file.match(/\b(MP|UP)\s*#?\s*[-:]?\s*(\d{1,8})\b/i);
  if (!labeled) return false;
  return labeled[1].toUpperCase() === prefix && String(Number(labeled[2])) === numeric;
}

function caseMatches(row: CaseRecord, parsed: ParsedOfficialId) {
  if (parsed.kind === "doe") return normalizeCompact(row.doeNetworkId || "") === parsed.official;
  return namusFileMatches(row.fileIdentifier || "", parsed.prefix || "MP", parsed.numeric || "");
}

function profileFromCase(row: CaseRecord, parsed: ParsedOfficialId, evidenceLinks: string[]): IdProfile {
  const profile = row.subjectProfile || {};
  return {
    officialId: parsed.official,
    kind: parsed.kind,
    name: row.subjectName || row.title || parsed.official,
    status: row.status,
    statusLabel: formatAlertLabel(row.status),
    date: row.lksAt || row.incidentStart || "",
    location: row.lksLocation || row.jurisdiction || "",
    sex: profile.sex || "",
    age: profile.ageAtDisappearance || "",
    height: profile.height || "",
    weight: profile.weight || "",
    hair: profile.hair || "",
    eyes: profile.eyes || "",
    circumstances: row.lksCircumstances || row.summary || "",
    links: linksFor(parsed, evidenceLinks),
    source: "case",
  };
}

function draftFromDoe(parsed: ParsedOfficialId): { profile: IdProfile; draft: IdCaseDraft } | null {
  if (parsed.kind !== "doe" || !parsed.doe) return null;
  const record = knownDoeRecord(parsed.official);
  if (!record) return null;
  const href = doeHref(parsed.doe);
  const summary = [record.circumstances, `Reference\n${href}`].filter(Boolean).join("\n\n");
  const subjectProfile: SubjectProfile = {
    ageAtDisappearance: record.ageAtDisappearance,
    currentEstimatedAge: record.currentAge,
    height: record.height,
    weight: record.weight,
    hair: record.hair,
    eyes: record.eyes,
    distinguishingMarks: record.distinguishingMarks,
    clothingLastSeen: record.clothing,
    medicalAlerts: record.medicalAlerts,
    sex: record.sex || "",
  };
  const profile: IdProfile = {
    officialId: parsed.official,
    kind: "doe",
    name: record.name,
    status: "ACTIVE_MISSING",
    statusLabel: formatAlertLabel("ACTIVE_MISSING"),
    date: record.lksDate,
    location: record.location,
    sex: subjectProfile.sex || "",
    age: subjectProfile.ageAtDisappearance || "",
    height: subjectProfile.height || "",
    weight: subjectProfile.weight || "",
    hair: subjectProfile.hair || "",
    eyes: subjectProfile.eyes || "",
    circumstances: record.circumstances,
    links: linksFor(parsed),
    source: "fixture",
  };
  return {
    profile,
    draft: {
      subjectName: record.name,
      summary,
      status: "ACTIVE_MISSING",
      jurisdiction: record.location,
      fileIdentifier: "",
      doeNetworkId: record.doeNetworkId || parsed.official,
      lksAt: record.lksDate,
      profile: subjectProfile,
    },
  };
}

function draftFromFixture(parsed: ParsedOfficialId): { profile: IdProfile; draft: IdCaseDraft } | null {
  if (parsed.kind !== "namus" || parsed.prefix !== "MP" || !parsed.numeric) return null;
  const record = knownNamusRecord(parsed.numeric);
  if (!record) return null;
  const lksAt = namusLksDatetime(record);
  const href = namusHref("MP", parsed.numeric);
  const summary = [record.circumstances, `Reference\n${href}`].filter(Boolean).join("\n\n");
  const subjectProfile: SubjectProfile = {
    ageAtDisappearance: record.ageAtDisappearance,
    currentEstimatedAge: record.currentAge,
    height: record.height,
    weight: record.weight,
    hair: record.hairColor,
    eyes: record.eyeColor,
    distinguishingMarks: record.distinguishingMarks,
    clothingLastSeen: record.clothing,
    medicalAlerts: record.medicalAlerts,
    sex: record.sex || "",
  };
  const profile: IdProfile = {
    officialId: parsed.official,
    kind: "namus",
    name: record.fullName,
    status: "ACTIVE_MISSING",
    statusLabel: formatAlertLabel("ACTIVE_MISSING"),
    date: lksAt,
    location: record.location,
    sex: subjectProfile.sex || "",
    age: subjectProfile.ageAtDisappearance || "",
    height: subjectProfile.height || "",
    weight: subjectProfile.weight || "",
    hair: subjectProfile.hair || "",
    eyes: subjectProfile.eyes || "",
    circumstances: record.circumstances,
    links: linksFor(parsed),
    source: "fixture",
  };
  return {
    profile,
    draft: {
      subjectName: record.fullName,
      summary,
      status: "ACTIVE_MISSING",
      jurisdiction: record.location,
      fileIdentifier: parsed.official,
      doeNetworkId: "",
      lksAt,
      profile: subjectProfile,
    },
  };
}

export async function lookupOfficialId(raw: string): Promise<IdLookupResult | null> {
  const parsed = parseOfficialId(raw);
  if (!parsed) return raw.trim() ? { state: "invalid" } : null;

  const cases = await db.cases.toArray();
  const match = cases
    .filter((row) => caseMatches(row, parsed))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (match) {
    const evidence = await db.evidence.toArray();
    const evidenceLinks = evidence
      .filter((item) => item.caseId === match.id || (item.linkedCaseIds || []).includes(match.id))
      .flatMap((item) => [item.sourceUrl, item.verifyingSourceUrl])
      .filter((url): url is string => Boolean(url));
    return { state: "case", caseId: match.id, profile: profileFromCase(match, parsed, evidenceLinks) };
  }

  const doeFixture = draftFromDoe(parsed);
  if (doeFixture) return { state: "fixture", ...doeFixture };
  const fixture = draftFromFixture(parsed);
  if (fixture) return { state: "fixture", ...fixture };

  return {
    state: "missing",
    prefill: {
      officialId: parsed.official,
      fileIdentifier: parsed.kind === "namus" ? parsed.official : "",
      doeNetworkId: parsed.kind === "doe" ? parsed.official : "",
    },
  };
}
