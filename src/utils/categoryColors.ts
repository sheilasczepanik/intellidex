export type SemanticCategory =
  | "people"
  | "vehicle"
  | "place"
  | "description"
  | "weapon"
  | "digital"
  | "unknown";

export type ColorSurface = "badge" | "dot" | "border" | "card" | "text";

export type CategoryColorInput = {
  category?: string | null;
  entityType?: string | null;
  role?: string | null;
  name?: string | null;
  text?: string | null;
};

type TokenSet = {
  text: string;
  bg: string;
  border: string;
  dot: string;
  left: string;
};

const TOKENS: Record<SemanticCategory, TokenSet> = {
  people: {
    text: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    dot: "bg-blue-500",
    left: "border-l-blue-500",
  },
  vehicle: {
    text: "text-purple-500",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    dot: "bg-purple-500",
    left: "border-l-purple-500",
  },
  place: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    dot: "bg-emerald-500",
    left: "border-l-emerald-500",
  },
  description: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-500",
    left: "border-l-amber-500",
  },
  weapon: {
    text: "text-rose-500",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    dot: "bg-rose-500",
    left: "border-l-rose-500",
  },
  digital: {
    text: "text-cyan-500",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
    dot: "bg-cyan-500",
    left: "border-l-cyan-500",
  },
  unknown: {
    text: "text-slate-500",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    dot: "bg-slate-400",
    left: "border-l-slate-400",
  },
};

const ALIASES: Record<string, SemanticCategory> = {
  people: "people",
  person: "people",
  persons: "people",
  people_person: "people",
  suspect: "people",
  suspects: "people",
  witness: "people",
  witnesses: "people",
  subject: "people",
  person_of_interest: "people",
  poi: "people",
  associate: "people",
  victim: "people",
  officer: "people",
  vehicle: "vehicle",
  vehicles: "vehicle",
  car: "vehicle",
  cars: "vehicle",
  truck: "vehicle",
  place: "place",
  places: "place",
  location: "place",
  locations: "place",
  address: "place",
  physical_description: "description",
  description: "description",
  clothing: "description",
  physical: "description",
  time: "digital",
  time_window: "digital",
  telecom: "digital",
  communication: "digital",
  evidence: "weapon",
  weapon: "weapon",
  weapons: "weapon",
  ballistics: "weapon",
  phone: "digital",
  phones: "digital",
  exhibit: "weapon",
  exhibits: "weapon",
};

const WEAPON_RE = /\b(weapon|gun|firearm|rifle|pistol|handgun|knife|ballistic|casing|cartridge|ammunition|shell casing|bloodstain|forensic)\b/i;
const DIGITAL_RE = /\b(cell tower|tower|ping|handset|imei|telecom|cctv|surveillance|footage|gps|phone ping|camera)\b/i;
const DESC_RE = /\b(clothing|clad|hoodie|mask|build|beard|hair|physical description|wearing|apparel)\b/i;
const VEHICLE_RE = /\b(vehicle|sedan|elantra|hyundai|volvo|plate|anpr|truck|car|white car)\b/i;
const PLACE_RE = /\b(motel|warehouse|address|king road|room \d|residence|campus|street|road)\b/i;

export function resolveSemanticCategory(input: string | CategoryColorInput): SemanticCategory {
  if (typeof input === "string") {
    return resolveSemanticCategory({ category: input, text: input });
  }

  const categoryKey = (input.category ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const typeKey = (input.entityType ?? "").trim().toLowerCase();
  const roleKey = (input.role ?? "").trim().toLowerCase();
  const blob = [input.category, input.entityType, input.role, input.name, input.text]
    .filter(Boolean)
    .join(" ");

  if (categoryKey === "physical_description") return "description";
  if (categoryKey === "vehicle") return "vehicle";
  if (categoryKey === "location") return "place";
  if (categoryKey === "person") return "people";
  if (categoryKey === "time_window") return "digital";

  if (WEAPON_RE.test(blob) || ALIASES[categoryKey] === "weapon") return "weapon";
  if (DIGITAL_RE.test(blob) || ALIASES[categoryKey] === "digital") return "digital";
  if (DESC_RE.test(blob) || ALIASES[categoryKey] === "description") return "description";

  if (typeKey === "vehicle") return "vehicle";
  if (typeKey === "place" || typeKey === "location") return "place";
  if (typeKey === "phone" || typeKey === "digital") return "digital";
  if (typeKey === "exhibit") return "weapon";
  if (typeKey === "person" || ALIASES[roleKey] === "people") return "people";

  if (VEHICLE_RE.test(blob) || ALIASES[categoryKey] === "vehicle") return "vehicle";
  if (PLACE_RE.test(blob) || ALIASES[categoryKey] === "place") return "place";
  if (ALIASES[categoryKey]) return ALIASES[categoryKey];
  if (ALIASES[typeKey]) return ALIASES[typeKey];
  if (ALIASES[roleKey]) return ALIASES[roleKey];
  return "unknown";
}

/** Unified tokens for badges, dots, borders, cards, and text. Unknown values fall back to slate. */
export function getCategoryColor(category: string | CategoryColorInput, type: ColorSurface): string {
  const key = resolveSemanticCategory(category);
  const token = TOKENS[key];
  if (type === "badge") return `${token.text} ${token.bg} ${token.border}`;
  if (type === "dot") return token.dot;
  if (type === "border") return token.left;
  if (type === "card") return `${token.bg} ${token.border}`;
  return token.text;
}

export function categoryLabel(category: string | CategoryColorInput): string {
  const key = resolveSemanticCategory(category);
  if (typeof category === "string") {
    const raw = category.trim().toLowerCase();
    if (raw === "time_window" || raw === "time") return "TIME";
    if (raw === "physical_description") return "DESCRIPTION";
    if (raw === "location") return "LOCATION";
    if (raw === "person") return "PERSON";
    if (raw === "vehicle") return "VEHICLE";
    if (raw === "telecom") return "TELECOM";
    if (raw === "communication") return "COMM";
    if (raw === "evidence") return "EVIDENCE";
  }
  switch (key) {
    case "people": return "PERSON";
    case "vehicle": return "VEHICLE";
    case "place": return "LOCATION";
    case "description": return "DESCRIPTION";
    case "weapon": return "EVIDENCE";
    case "digital": return "DIGITAL";
    default: return "UNCATEGORIZED";
  }
}
