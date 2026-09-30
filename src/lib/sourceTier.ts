import { formatTag } from "./formatTag";

/** Official vs media-intelligence classification (distinct from media `sourceType` pdf/image/text/web_article). */
export type EvidenceTier = "primary" | "secondary";

export type EvidenceSourceClass =
  | "affidavit"
  | "police_report"
  | "forensic_record"
  | "news_article"
  | "press_release"
  | "note";

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

export function classifySource(input: {
  fileName?: string;
  originalFileName?: string;
  sourceType?: string;
  sourceUrl?: string;
  fileType?: string;
  fromWeb?: boolean;
  fromPaste?: boolean;
  fromEditorial?: boolean;
}): { tier: EvidenceTier; sourceClass: EvidenceSourceClass } {
  const name = `${input.fileName || ""} ${input.originalFileName || ""}`.toLowerCase();
  const url = (input.sourceUrl || "").toLowerCase();
  if (input.fromEditorial) {
    return { tier: "secondary", sourceClass: "news_article" };
  }
  const web = Boolean(
    input.fromWeb
    || input.sourceType === "web_article"
    || input.fileType === "web_article"
    || url,
  );
  if (web) {
    const press = /press[-_\s]?release|prnews|newswire|bulletin/.test(`${name} ${url}`);
    return { tier: "secondary", sourceClass: press ? "press_release" : "news_article" };
  }
  if (input.fromPaste || input.fileType === "txt" || input.sourceType === "text") {
    if (/\.(pdf)$/.test(name) || input.sourceType === "pdf") {
      return classifyOfficialName(name);
    }
    return { tier: "primary", sourceClass: "note" };
  }
  return classifyOfficialName(name);
}

function classifyOfficialName(name: string): { tier: EvidenceTier; sourceClass: EvidenceSourceClass } {
  if (/affidavit|warrant|complaint/.test(name)) return { tier: "primary", sourceClass: "affidavit" };
  if (/forensic|lab[-_\s]?report|autopsy|ballistic|dna/.test(name)) return { tier: "primary", sourceClass: "forensic_record" };
  if (/\.txt|\.md|\.csv|\.json|\.log/.test(name) && !/\.pdf/.test(name)) {
    return { tier: "primary", sourceClass: "note" };
  }
  return { tier: "primary", sourceClass: "police_report" };
}

export function sourceClassLabel(cls?: EvidenceSourceClass) {
  if (cls === "affidavit") return "Affidavit";
  if (cls === "police_report") return "Police report";
  if (cls === "forensic_record") return "Forensic record";
  if (cls === "news_article") return "News article";
  if (cls === "press_release") return "Press release";
  if (cls === "note") return "Note";
  return cls ? formatTag(cls) : "";
}

export function isUncorroboratedEntity(ent: {
  uncorroborated?: boolean;
  provenanceTier?: "primary" | "secondary";
}) {
  return ent.uncorroborated === true || ent.provenanceTier === "secondary";
}

export const MEDIA_CUSTODY_BANNER =
  "Media reports and external articles are indexed as secondary intelligence to preserve chain of custody and prevent uncorroborated claims from altering official case records.";
