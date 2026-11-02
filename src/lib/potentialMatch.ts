import { parseDoeNetworkId } from "./doeNetworkId";

export type MatchAudience = "state_researcher" | "coordinator";

const CASE_NUMBER = /\b(?:\d{4}|\d{2})[A-Z]{4}\b|\b(?:MP|UP|UF|UM|DF|DM|UID)[-# ]?\d{2,8}(?:-\d{2,8})?\b|\bCASE-\d{3,8}\b|\b\d{2,4}-[A-Z]{2,8}-\d{2,8}\b/gi;
const LINK = /https?:\/\/[^\s<>"')\]]+/gi;

export function caseNumbersIn(text: string) {
  const found = text.toUpperCase().match(CASE_NUMBER) || [];
  const unique = new Set(found.map((token) => token.replace(/\s+/g, "").replace(/#/g, "")));
  return [...unique];
}

export function linksIn(text: string) {
  const found = text.match(LINK) || [];
  return [...new Set(found.map((link) => link.replace(/[.,;]+$/, "")))];
}

export function isCharleyLink(url: string) {
  return /charleyproject\.org/i.test(url);
}

export function validatePotentialMatch(title: string, body: string) {
  const errors: string[] = [];
  const numbers = caseNumbersIn(title);
  if (numbers.length < 2) {
    errors.push("Put at least two case numbers in the title (Doe Network ID, NamUs MP/UP, or agency number).");
  }
  const links = linksIn(body);
  if (links.length === 0) {
    errors.push("Put at least one case link in the body.");
  }
  const verifying = links.filter((link) => !isCharleyLink(link));
  if (links.length > 0 && verifying.length === 0) {
    errors.push("A Charley Project link cannot stand alone. Add a NamUs, agency, or Doe Network link as the verifying source.");
  }
  return { ok: errors.length === 0, errors, numbers, links, verifying };
}

export function formatPotentialMatch(input: {
  title: string;
  body: string;
  audience: MatchAudience;
  doeNetworkId?: string;
}) {
  const check = validatePotentialMatch(input.title, input.body);
  const who = input.audience === "coordinator" ? "Area coordinator" : "State researcher";
  const doe = input.doeNetworkId ? parseDoeNetworkId(input.doeNetworkId) : null;
  const lines = [
    `TO: ${who}`,
    `SUBJECT: Potential Match — ${input.title.trim()}`,
    "",
    input.body.trim(),
    "",
    "---",
    "Filed from INTELLIDEX for The Doe Network.",
    doe ? `Workspace Doe Network ID: ${doe.id} (${doe.statusLabel}, ${doe.stateName}, ${doe.yearLabel})` : "",
    `Case numbers in the title: ${check.numbers.join(", ") || "—"}`,
    "Verifying links:",
    ...(check.verifying.length ? check.verifying.map((link) => `- ${link}`) : ["- none"]),
  ];
  const charley = check.links.filter(isCharleyLink);
  if (charley.length) {
    lines.push("Charley Project links (secondary intelligence only):");
    lines.push(...charley.map((link) => `- ${link}`));
  }
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trim();
}
