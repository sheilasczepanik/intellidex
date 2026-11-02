/** Doe Network case numbers: 4 digits + 4 letters (1187UMFL), plus the short year form (93DMFL). */

const DOE_ID = /^(\d{4}|\d{2})([A-Z]{2})([A-Z]{2})$/;

const STATUS_LABELS: Record<string, string> = {
  DM: "Disappeared Male",
  DF: "Disappeared Female",
  DU: "Disappeared, sex unknown",
  UM: "Unidentified Male",
  UF: "Unidentified Female",
  UU: "Unidentified, sex unknown",
};

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia", PR: "Puerto Rico",
};

export type DoeNetworkId = {
  id: string;
  serial: string;
  yearLabel: string;
  statusCode: string;
  statusLabel: string;
  state: string;
  stateName: string;
};

export function normalizeDoeNetworkId(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function parseDoeNetworkId(raw: string): DoeNetworkId | null {
  const id = normalizeDoeNetworkId(raw);
  const match = DOE_ID.exec(id);
  if (!match) return null;
  const serial = match[1];
  const statusCode = match[2];
  const state = match[3];
  const statusLabel = STATUS_LABELS[statusCode];
  const stateName = STATE_NAMES[state];
  if (!statusLabel || !stateName) return null;
  return {
    id,
    serial,
    yearLabel: yearLabel(serial),
    statusCode,
    statusLabel,
    state,
    stateName,
  };
}

function yearLabel(serial: string) {
  if (serial.length === 4) {
    const year = Number(serial);
    if (year >= 1900 && year <= 2099) return String(year);
    return `serial ${serial}`;
  }
  const yy = Number(serial);
  const year = yy >= 30 ? 1900 + yy : 2000 + yy;
  return String(year);
}

export function doeNetworkHint(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parsed = parseDoeNetworkId(trimmed);
  if (!parsed) return "Use 4 digits and 4 letters, such as 1187UMFL, or the short form 93DMFL.";
  return `${parsed.id} · ${parsed.yearLabel} · ${parsed.statusLabel} · ${parsed.stateName}`;
}
