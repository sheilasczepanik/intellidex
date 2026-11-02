import type { CaseRecord, EvidenceRecord, MatchLinkStatus } from "../db/schema";
import { formatPotentialMatch, validatePotentialMatch } from "./potentialMatch";

export const MATCH_STATUS_LABEL: Record<MatchLinkStatus, string> = {
  under_review: "Under Review",
  submitted_area_director: "Submitted to Area Director",
  ruled_out: "Ruled Out",
};

export function pairKey(a: string, b: string) {
  return [a, b].sort().join("|");
}

export function caseNumberToken(row: CaseRecord) {
  return (row.doeNetworkId || row.fileIdentifier || row.id).trim();
}

export function sourceLinksFor(cases: CaseRecord[], evidence: EvidenceRecord[]) {
  const ids = new Set(cases.map((row) => row.id));
  const links = new Set<string>();
  for (const item of evidence) {
    const onPair = ids.has(item.caseId) || (item.linkedCaseIds || []).some((id) => ids.has(id));
    if (!onPair) continue;
    for (const url of [item.sourceUrl, item.verifyingSourceUrl]) {
      if (url && /^https?:\/\//i.test(url)) links.add(url.trim());
    }
  }
  for (const row of cases) {
    const file = row.fileIdentifier || "";
    const digits = file.match(/\d{3,8}/);
    if (digits && /namus|\bmp\b|\bup\b/i.test(file)) {
      links.add(`https://www.namus.gov/MissingPersons/Case#/${digits[0]}`);
    }
  }
  return [...links];
}

export function buildPairPacket(a: CaseRecord, b: CaseRecord, evidence: EvidenceRecord[], status: MatchLinkStatus = "under_review") {
  const title = `${caseNumberToken(a)} × ${caseNumberToken(b)}`;
  const links = sourceLinksFor([a, b], evidence);
  const narrative = `${a.subjectName || a.title} (${caseNumberToken(a)}) compared with ${b.subjectName || b.title} (${caseNumberToken(b)}).`;
  const body = [narrative, ...links].join("\n");
  const check = validatePotentialMatch(title, body);
  const formatted = check.ok
    ? [
      `STATUS: ${MATCH_STATUS_LABEL[status]}`,
      formatPotentialMatch({
        title,
        body,
        audience: "coordinator",
        doeNetworkId: a.doeNetworkId || b.doeNetworkId,
      }),
    ].join("\n\n")
    : "";
  const storedBody = check.ok ? body : `${body}\n\n${check.errors.join("\n")}`;
  return { title, body: storedBody, formatted, errors: check.errors, links };
}
