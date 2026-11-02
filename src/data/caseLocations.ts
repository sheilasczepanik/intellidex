export interface CaseLocationPin {
  id: string;
  title: string;
  category: "LKS" | "WITNESS" | "TIMELINE" | "EVIDENCE" | "ACCIDENT";
  coordinates: { lat: number; lng: number };
  timestamp?: string;
  description: string;
  sourceDoc?: string;
}

export const MAURA_MURRAY_LOCATIONS: CaseLocationPin[] = [
  {
    id: "loc-1",
    title: "Melville Hall Security Desk",
    category: "WITNESS",
    coordinates: { lat: 42.3814, lng: -72.5311 },
    timestamp: "2004-02-05 01:20 EST",
    description: "UMass Amherst - Security supervisor observed emotional distress incident.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-2",
    title: "Amherst Brewing Company",
    category: "TIMELINE",
    coordinates: { lat: 42.3758, lng: -72.5199 },
    timestamp: "2004-02-07 21:00 EST",
    description: "Amherst, MA - Dinner with Fred Murray prior to borrowing Corolla.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-3",
    title: "Coolidge Hall (Room 1001)",
    category: "TIMELINE",
    coordinates: { lat: 42.3831, lng: -72.5302 },
    timestamp: "2004-02-08 00:30 EST",
    description: "UMass Amherst - Dorm gathering attended; cell phone left in room.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-4",
    title: "Route 9 Crash Site",
    category: "ACCIDENT",
    coordinates: { lat: 42.3551, lng: -72.5684 },
    timestamp: "2004-02-08 03:33 EST",
    description: "Hadley, MA - Collision into guardrail; car towed to Hadley Quality Inn.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-5",
    title: "Fleet Bank ATM",
    category: "EVIDENCE",
    coordinates: { lat: 42.3618, lng: -72.5369 },
    timestamp: "2004-02-09 15:15 EST",
    description: "195 University Dr, Amherst - Security footage verified $280 cash withdrawal alone.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-6",
    title: "Liquors 44",
    category: "EVIDENCE",
    coordinates: { lat: 42.3562, lng: -72.5691 },
    timestamp: "2004-02-09 15:40 EST",
    description: "Russell St, Hadley, MA - Purchase of boxed Franzia wine, vodka, and liqueurs.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-7",
    title: "The Weathered Barn (Route 112)",
    category: "LKS",
    coordinates: { lat: 44.1192, lng: -71.9363 },
    timestamp: "2004-02-09 19:27 EST",
    description: "Haverhill, NH - Last Known Sighting; Saturn found crashed into snowbank.",
    sourceDoc: "MM_1.pdf",
  },
  {
    id: "loc-8",
    title: "Atwood Residence",
    category: "WITNESS",
    coordinates: { lat: 44.1187, lng: -71.9348 },
    timestamp: "2004-02-09 19:42 EST",
    description: "Route 112, Haverhill, NH - Butch Atwood residence where 911 dispatch was placed.",
    sourceDoc: "MM_1.pdf",
  },
];

/** Maura workspaces, including renamed titles that still carry the case file. */
const MAURA_CASE_IDS = new Set(["CASE-0041", "CASE-0047", "CASE-0701", "CASE-4965"]);

export function isMauraMurrayLocationCase(row: { id?: string; title?: string; subjectName?: string; fileIdentifier?: string }) {
  if (row.id && MAURA_CASE_IDS.has(row.id)) return true;
  return /maura murray/i.test(`${row.subjectName || ""} ${row.title || ""} ${row.fileIdentifier || ""}`);
}

/** Eight verified pins for a Maura Murray case. Other cases keep their own places. */
export function locationsForCase(row: { id?: string; title?: string; subjectName?: string; fileIdentifier?: string }): CaseLocationPin[] {
  return isMauraMurrayLocationCase(row) ? MAURA_MURRAY_LOCATIONS : [];
}

/** Decimal coordinate pair written by the scanner or a curated dossier. */
export function readCoordinates(text: string): { lat: number; lng: number } | null {
  const match = text.match(/(-?\d{1,2}\.\d{3,6})\s*,\s*(-?\d{1,3}\.\d{3,6})/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function pinsFromFindings(rows: Array<{ id: string; title: string; text: string; timestamp?: string; lat?: number; lng?: number }>): CaseLocationPin[] {
  const pins: CaseLocationPin[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = typeof row.lat === "number" && typeof row.lng === "number"
      ? { lat: row.lat, lng: row.lng }
      : readCoordinates(row.text);
    if (!parsed) continue;
    const key = `${parsed.lat.toFixed(3)},${parsed.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({
      id: `finding-${row.id}`,
      title: row.title || "Extracted coordinate",
      category: "EVIDENCE",
      coordinates: parsed,
      timestamp: row.timestamp,
      description: row.text.replace(/\s+/g, " ").trim().slice(0, 180),
      sourceDoc: "Extraction",
    });
  }
  return pins;
}
