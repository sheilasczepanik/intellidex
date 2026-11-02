import { formatTag } from "./formatTag";

/** Official vs media-intelligence classification (distinct from media `sourceType` pdf/image/text/web_article). */
export type EvidenceTier = "primary" | "secondary";

export type EvidenceAuthority = "verified_government" | "secondary_media";
export type EvidenceAcceptance = "accepted" | "held";

export type EvidenceSourceClass =
  | "affidavit"
  | "police_report"
  | "forensic_record"
  | "news_article"
  | "press_release"
  | "note"
  | "namus_record";

export type SourceClassification = {
  tier: EvidenceTier;
  sourceClass: EvidenceSourceClass;
  authority?: EvidenceAuthority;
  acceptance: EvidenceAcceptance;
};

export function isSecondaryEvidence(ev: {
  tier?: EvidenceTier;
  sourceClass?: EvidenceSourceClass;
  sourceType?: string;
  sourceUrl?: string;
  fileType?: string;
}): boolean {
  if (ev.tier === "secondary") return true;
  if (ev.tier === "primary") return false;
  if (ev.sourceClass === "news_article" || ev.sourceClass === "press_release") return true;
  return ev.sourceType === "web_article" || ev.fileType === "web_article" || Boolean(ev.sourceUrl);
}

export function isNamusReference(input: {
  sourceUrl?: string;
  fileName?: string;
  originalFileName?: string;
}) {
  const url = (input.sourceUrl || "").toLowerCase();
  if (/namus\.gov|namus\.nij/.test(url)) return true;
  const name = `${input.fileName || ""} ${input.originalFileName || ""}`.toLowerCase();
  return /^namus[\s._-]/.test(name.trim()) || /\bnamus[-_ ]?(mp|up)?\d/.test(name);
}

export function isCharleyProjectReference(input: {
  sourceUrl?: string;
  fileName?: string;
  originalFileName?: string;
}) {
  const blob = `${input.sourceUrl || ""} ${input.fileName || ""} ${input.originalFileName || ""}`.toLowerCase();
  return /charleyproject\.org|\bcharley project\b/.test(blob);
}

export function isVerifyingSource(url: string) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return !isCharleyProjectReference({ sourceUrl: trimmed });
}

export function classifySource(input: {
  fileName?: string;
  originalFileName?: string;
  sourceType?: string;
  sourceUrl?: string;
  fileType?: string;
  fromWeb?: boolean;
  fromPaste?: boolean;
  fromEditorial?: boolean;
  verifyingSourceUrl?: string;
}): SourceClassification {
  const name = `${input.fileName || ""} ${input.originalFileName || ""}`.toLowerCase();
  const url = (input.sourceUrl || "").toLowerCase();
  if (isNamusReference(input)) {
    return { tier: "primary", sourceClass: "namus_record", authority: "verified_government", acceptance: "accepted" };
  }
  if (isCharleyProjectReference(input)) {
    const verified = Boolean(input.verifyingSourceUrl && isVerifyingSource(input.verifyingSourceUrl));
    return {
      tier: "secondary",
      sourceClass: "news_article",
      authority: "secondary_media",
      acceptance: verified ? "accepted" : "held",
    };
  }
  if (input.fromEditorial) {
    return { tier: "secondary", sourceClass: "news_article", authority: "secondary_media", acceptance: "accepted" };
  }
  const web = Boolean(
    input.fromWeb
    || input.sourceType === "web_article"
    || input.fileType === "web_article"
    || url,
  );
  if (web) {
    const press = /press[-_\s]?release|prnews|newswire|bulletin/.test(`${name} ${url}`);
    return {
      tier: "secondary",
      sourceClass: press ? "press_release" : "news_article",
      authority: "secondary_media",
      acceptance: "accepted",
    };
  }
  if (input.fromPaste || input.fileType === "txt" || input.sourceType === "text") {
    if (/\.(pdf)$/.test(name) || input.sourceType === "pdf") {
      return classifyOfficialName(name);
    }
    return { tier: "primary", sourceClass: "note", acceptance: "accepted" };
  }
  return classifyOfficialName(name);
}

function classifyOfficialName(name: string): SourceClassification {
  if (/affidavit|warrant|complaint/.test(name)) return { tier: "primary", sourceClass: "affidavit", acceptance: "accepted" };
  if (/forensic|lab[-_\s]?report|autopsy|ballistic|dna/.test(name)) return { tier: "primary", sourceClass: "forensic_record", acceptance: "accepted" };
  if (/\.txt|\.md|\.csv|\.json|\.log/.test(name) && !/\.pdf/.test(name)) {
    return { tier: "primary", sourceClass: "note", acceptance: "accepted" };
  }
  return { tier: "primary", sourceClass: "police_report", acceptance: "accepted" };
}

export function sourceClassLabel(cls?: EvidenceSourceClass) {
  if (cls === "affidavit") return "Affidavit";
  if (cls === "police_report") return "Police report";
  if (cls === "forensic_record") return "Forensic record";
  if (cls === "news_article") return "News article";
  if (cls === "press_release") return "Press release";
  if (cls === "note") return "Note";
  if (cls === "namus_record") return "NamUs record";
  return cls ? formatTag(cls) : "";
}

export function isUncorroboratedEntity(ent: {
  uncorroborated?: boolean;
  provenanceTier?: "primary" | "secondary";
}) {
  return ent.uncorroborated === true || ent.provenanceTier === "secondary";
}

export const MEDIA_CUSTODY_BANNER =
  "Media reports and external articles are indexed as secondary intelligence to preserve chain of custody and prevent uncorroborated claims from altering official case records. A Charley Project page cannot be accepted on its own — pair it with a NamUs, agency, or Doe Network link.";
