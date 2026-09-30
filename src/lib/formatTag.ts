const KNOWN_TAGS: Record<string, string> = {
  last_seen: "Last seen",
  item_recovered: "Item recovered",
  cell_ping: "Cell ping",
  search_grid: "Search grid",
  person_of_interest: "Person of interest",
  missing_person: "Missing person",
  web_article: "Web article",
  police_report: "Police report",
  forensic_record: "Forensic record",
  press_release: "Press release",
  news_article: "News article",
  active_missing: "Active missing",
  endangered_missing: "Endangered missing",
  critical_medical: "Critical medical",
};

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word) && word.length <= 4) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Human-readable badge/tag copy: snake_case keys become spaced labels. */
export function formatTag(tag: string | undefined | null): string {
  const raw = String(tag ?? "").trim();
  if (!raw) return "";
  const known = KNOWN_TAGS[raw.toLowerCase()];
  if (known) return known;
  return titleCaseWords(raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim());
}

export function formatTagUpper(tag: string | undefined | null): string {
  return formatTag(tag).toUpperCase();
}
