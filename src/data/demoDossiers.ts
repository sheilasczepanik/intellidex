import { MAURA_MURRAY_LOCATIONS, type CaseLocationPin } from "./caseLocations";
import { MM_1_EXTRACTIONS, mm1ReportText, type Mm1Extraction } from "./caseFixtures";
import type { ExtractCategory } from "../lib/extractSchema";

export type DemoDossierId = "MM_1" | "CONFLICT_DISPATCH";

export type DemoFinding = {
  id: string;
  category: ExtractCategory;
  title: string;
  details: string;
  exactSnippet: string;
  pageNumber: number;
  timestamp: string;
  timestampLabel: string;
  confidence: number;
};

const PLACE_HINTS: Array<{ test: RegExp; pinId: string }> = [
  { test: /atwood/i, pinId: "loc-8" },
  { test: /liquors|franzia|russell st/i, pinId: "loc-6" },
  { test: /fleet bank|university drive|\batm\b|\$280/i, pinId: "loc-5" },
  { test: /route 9|hadley|ruddock|quality inn/i, pinId: "loc-4" },
  { test: /coolidge/i, pinId: "loc-3" },
  { test: /brewing|fred murray/i, pinId: "loc-2" },
  { test: /melville/i, pinId: "loc-1" },
  { test: /weathered barn|route 112|tailpipe|snowbank/i, pinId: "loc-7" },
];

function withPlace(text: string, pin: CaseLocationPin | undefined) {
  if (!pin) return text;
  const coords = `${pin.coordinates.lat}, ${pin.coordinates.lng}`;
  if (text.includes(coords)) return text;
  return `${text} Coordinates ${coords}.`;
}

function pinFor(text: string) {
  const hint = PLACE_HINTS.find((row) => row.test.test(text));
  return hint ? MAURA_MURRAY_LOCATIONS.find((pin) => pin.id === hint.pinId) : undefined;
}

function mm1Category(category: Mm1Extraction["category"]): ExtractCategory {
  if (category === "EVIDENCE") return "evidence";
  if (category === "TIMELINE_EVENT") return "time";
  return "communication";
}

function mm1Findings(): DemoFinding[] {
  const narrative = MM_1_EXTRACTIONS.map((item) => {
    const blob = `${item.title} ${item.details} ${item.exactSnippet}`;
    const pin = pinFor(blob);
    return {
      id: item.id,
      category: mm1Category(item.category),
      title: item.title,
      details: withPlace(item.details, pin),
      exactSnippet: item.exactSnippet,
      pageNumber: item.pageNumber,
      timestamp: item.timestamp,
      timestampLabel: item.timestamp.replace("T", " ").replace(/:00$/, ""),
      confidence: item.confidence,
    };
  });
  const places = MAURA_MURRAY_LOCATIONS.map((pin) => ({
    id: `mm1-${pin.id}`,
    category: "location" as const,
    title: pin.title,
    details: withPlace(pin.description, pin),
    exactSnippet: `${pin.title}. ${pin.description}`,
    pageNumber: 1,
    timestamp: pin.timestamp?.replace(" EST", "").replace(" ", "T") || "",
    timestampLabel: pin.timestamp || "",
    confidence: 0.99,
  }));
  return [...places, ...narrative];
}

const CONFLICT_PAGES: Array<{ page: number; sentence: string; finding: Omit<DemoFinding, "exactSnippet" | "pageNumber"> }> = [
  {
    page: 1,
    sentence: "Email to supervisor SKINNER cited bereavement leave after a death in the family.",
    finding: {
      id: "conflict-bereavement",
      category: "communication",
      title: "Bereavement Leave Notice to Supervisor",
      details: "Email to supervisor SKINNER cited bereavement leave after a death in the family.",
      timestamp: "2004-02-06T09:10:00",
      timestampLabel: "2004-02-06 09:10",
      confidence: 0.98,
    },
  },
  {
    page: 2,
    sentence: "Family confirmed no tragedy and stated that no death in the family had occurred.",
    finding: {
      id: "conflict-family",
      category: "communication",
      title: "Family Denial of Family Bereavement",
      details: "Family confirmed no tragedy and stated that no death in the family had occurred.",
      timestamp: "2004-02-10T14:05:00",
      timestampLabel: "2004-02-10 14:05",
      confidence: 0.98,
    },
  },
  {
    page: 3,
    sentence: "The scene report recorded a wine dash across the dash and open bottles of liquor beside the Saturn.",
    finding: {
      id: "conflict-alcohol",
      category: "evidence",
      title: "Open Alcohol Containers at the Scene",
      details: "The scene report recorded a wine dash across the dash and open bottles of liquor beside the Saturn. Coordinates 44.1192, -71.9363.",
      timestamp: "2004-02-09T19:46:00",
      timestampLabel: "2004-02-09 19:46",
      confidence: 0.96,
    },
  },
  {
    page: 4,
    sentence: "A neighbor told investigators she didn't drink much and was not a heavy drinker.",
    finding: {
      id: "conflict-sober",
      category: "communication",
      title: "Witness Perception of Drinking",
      details: "A neighbor told investigators she didn't drink much and was not a heavy drinker.",
      timestamp: "2004-02-11T11:20:00",
      timestampLabel: "2004-02-11 11:20",
      confidence: 0.94,
    },
  },
  {
    page: 5,
    sentence: "Dispatch placed the Saturn at the Weathered Barn on Route 112 at 19:27 EST.",
    finding: {
      id: "conflict-barn",
      category: "location",
      title: "Dispatch: Weathered Barn",
      details: "Dispatch placed the Saturn at the Weathered Barn on Route 112 at 19:27 EST. Coordinates 44.1192, -71.9363.",
      timestamp: "2004-02-09T19:27:00",
      timestampLabel: "2004-02-09 19:27",
      confidence: 0.99,
    },
  },
  {
    page: 6,
    sentence: "A second dispatch placed the same Saturn at Liquors 44 on Russell Street at 19:27 EST.",
    finding: {
      id: "conflict-liquors",
      category: "location",
      title: "Dispatch: Liquors 44",
      details: "A second dispatch placed the same Saturn at Liquors 44 on Russell Street at 19:27 EST. Coordinates 42.3562, -72.5691.",
      timestamp: "2004-02-09T19:27:00",
      timestampLabel: "2004-02-09 19:27",
      confidence: 0.99,
    },
  },
];

function conflictFindings(): DemoFinding[] {
  return CONFLICT_PAGES.map((page) => ({
    ...page.finding,
    exactSnippet: page.sentence,
    pageNumber: page.page,
  }));
}

export function conflictLogText() {
  return CONFLICT_PAGES.map((page) => `--- Page ${page.page} ---\n${page.sentence}`).join("\n\n");
}

export function demoDossier(id: DemoDossierId) {
  if (id === "MM_1") {
    return {
      id,
      sourceUrl: "dossier://MM_1",
      fileName: "MM_1.pdf",
      fileType: "pdf",
      sourceType: "pdf" as const,
      pageCount: 38,
      text: mm1ReportText(),
      findings: mm1Findings(),
    };
  }
  return {
    id,
    sourceUrl: "dossier://CONFLICT_DISPATCH",
    fileName: "Location & Contradiction Log.txt",
    fileType: "txt",
    sourceType: "text" as const,
    pageCount: 6,
    text: conflictLogText(),
    findings: conflictFindings(),
  };
}
