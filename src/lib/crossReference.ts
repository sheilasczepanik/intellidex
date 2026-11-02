import type { CaseRecord } from "../db/schema";
import { parseDoeNetworkId } from "./doeNetworkId";
import { metersBetween, parseCoordinates } from "./geo";

export type Overlap = "match" | "close" | "unique" | "empty";

export type TraitCell = {
  value: string;
  overlap: Overlap;
};

export type TraitRow = {
  key: string;
  label: string;
  cells: TraitCell[];
};

const STOP = new Set(["last", "known", "near", "area", "county", "parish", "city", "state", "missing", "person", "found", "remains", "body", "location", "sighting"]);

export function caseKindLabel(row: CaseRecord) {
  const doe = parseDoeNetworkId(row.doeNetworkId || "");
  if (doe) return `${doe.statusLabel} · ${doe.stateName}`;
  if (row.recoveryAt || row.recoveryLocation || row.locatedAt) return "Recovery record";
  return "Missing person";
}

export function missingStamp(row: CaseRecord) {
  return (row.lksAt || row.incidentStart || "").trim();
}

export function recoveryStamp(row: CaseRecord) {
  return (row.recoveryAt || row.locatedAt || "").trim();
}

export function lastKnownPlace(row: CaseRecord) {
  return (row.lksLocation || row.jurisdiction || "").trim();
}

export function recoveryPlace(row: CaseRecord) {
  return (row.recoveryLocation || "").trim();
}

export function compareCases(cases: CaseRecord[]): { rows: TraitRow[]; gaps: string[] } {
  const descriptors = cases.map(describe);
  const rows: TraitRow[] = [
    row("classification", "Classification", descriptors.map((d) => d.kind), classifyOverlap),
    row("height", "Height", descriptors.map((d) => d.heightLabel), (values) => numericOverlap(values, descriptors.map((d) => d.heightIn), 2, 4)),
    row("age", "Age range", descriptors.map((d) => d.ageLabel), (values) => rangeOverlap(values, descriptors.map((d) => d.age))),
    row("hair", "Hair", descriptors.map((d) => d.hair), textOverlap),
    row("eyes", "Eyes", descriptors.map((d) => d.eyes), textOverlap),
    row("marks", "Marks / tattoos", descriptors.map((d) => d.marks), tokenOverlap),
    row("lastKnown", "Last known location", descriptors.map((d) => d.lastKnown), placeOverlap),
    row("recovery", "Recovery location", descriptors.map((d) => d.recovery), placeOverlap),
    row("missingDate", "Missing date", descriptors.map((d) => d.missingLabel), presentOnly),
    row("recoveryDate", "Recovery date", descriptors.map((d) => d.recoveryLabel), presentOnly),
  ];
  return { rows, gaps: timelineGaps(cases) };
}

function presentOnly(values: string[]): Overlap[] {
  return values.map((value) => (value.trim() ? "unique" : "empty"));
}

function row(
  key: string,
  label: string,
  values: string[],
  score: (values: string[]) => Overlap[],
): TraitRow {
  const overlaps = score(values);
  return {
    key,
    label,
    cells: values.map((value, index) => ({ value: value.trim() || "—", overlap: overlaps[index] || "empty" })),
  };
}

function describe(rowCase: CaseRecord) {
  const profile = rowCase.subjectProfile || {};
  const heightIn = heightInches(profile.height || "");
  const age = ageSpan(profile.ageAtDisappearance || "", profile.currentEstimatedAge || "");
  const missing = missingStamp(rowCase);
  const recovered = recoveryStamp(rowCase);
  return {
    kind: caseKindLabel(rowCase),
    heightLabel: (profile.height || "").trim(),
    heightIn,
    ageLabel: age?.label || "",
    age: age?.span || null,
    hair: (profile.hair || "").trim(),
    eyes: (profile.eyes || "").trim(),
    marks: (profile.distinguishingMarks || "").trim(),
    lastKnown: lastKnownPlace(rowCase),
    recovery: recoveryPlace(rowCase),
    missingLabel: missing ? formatWhen(missing) : "",
    recoveryLabel: recovered ? formatWhen(recovered) : "",
  };
}

function formatWhen(raw: string) {
  const ms = Date.parse(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function heightInches(raw: string) {
  const text = raw.toLowerCase().replace(/[“”]/g, '"');
  const feet = text.match(/(\d)\s*['′]\s*(\d{1,2})/);
  if (feet) return Number(feet[1]) * 12 + Number(feet[2]);
  const cm = text.match(/(\d{2,3})\s*cm/);
  if (cm) return Math.round(Number(cm[1]) / 2.54);
  const inches = text.match(/(\d{2,3})\s*(?:in|inches)\b/);
  if (inches) return Number(inches[1]);
  return null;
}

function ageSpan(atDisappearance: string, current: string) {
  const blob = `${atDisappearance} ${current}`.trim();
  if (!blob) return null;
  const range = blob.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/i);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    return { label: blob, span: [Math.min(low, high), Math.max(low, high)] as [number, number] };
  }
  const one = blob.match(/\d{1,2}/);
  if (!one) return null;
  const age = Number(one[0]);
  const currentAge = current.match(/\d{1,2}/);
  const high = currentAge ? Number(currentAge[0]) : age;
  return { label: blob, span: [Math.min(age, high), Math.max(age, high)] as [number, number] };
}

function filled(values: string[]) {
  return values.map((value, index) => ({ value: value.trim(), index })).filter((item) => item.value);
}

function classifyOverlap(values: string[]): Overlap[] {
  const present = filled(values);
  const counts = new Map<string, number>();
  for (const item of present) {
    const key = item.value.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return values.map((value) => {
    const text = value.trim();
    if (!text) return "empty";
    return (counts.get(text.toLowerCase()) || 0) > 1 ? "match" : "unique";
  });
}

function numericOverlap(labels: string[], numbers: Array<number | null>, matchWithin: number, closeWithin: number): Overlap[] {
  return labels.map((label, index) => {
    if (!label.trim() || numbers[index] == null) return label.trim() ? "unique" : "empty";
    const mine = numbers[index] as number;
    let best: Overlap = "unique";
    numbers.forEach((other, otherIndex) => {
      if (otherIndex === index || other == null) return;
      const delta = Math.abs(mine - other);
      if (delta <= matchWithin) best = "match";
      else if (delta <= closeWithin && best !== "match") best = "close";
    });
    return best;
  });
}

function rangeOverlap(labels: string[], ranges: Array<[number, number] | null>): Overlap[] {
  return labels.map((label, index) => {
    const mine = ranges[index];
    if (!label.trim() || !mine) return label.trim() ? "unique" : "empty";
    let best: Overlap = "unique";
    ranges.forEach((other, otherIndex) => {
      if (otherIndex === index || !other) return;
      const overlaps = mine[0] <= other[1] && other[0] <= mine[1];
      if (!overlaps) return;
      const same = mine[0] === other[0] && mine[1] === other[1];
      if (same) best = "match";
      else if (best !== "match") best = "close";
    });
    return best;
  });
}

function textOverlap(values: string[]): Overlap[] {
  const norm = values.map((value) => value.trim().toLowerCase());
  return norm.map((value, index) => {
    if (!value) return "empty";
    let best: Overlap = "unique";
    norm.forEach((other, otherIndex) => {
      if (otherIndex === index || !other) return;
      if (value === other) best = "match";
      else if ((value.includes(other) || other.includes(value)) && best !== "match") best = "close";
    });
    return best;
  });
}

function tokens(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP.has(word)));
}

function tokenOverlap(values: string[]): Overlap[] {
  const sets = values.map((value) => tokens(value));
  return values.map((value, index) => {
    if (!value.trim()) return "empty";
    const mine = sets[index];
    if (mine.size === 0) return "unique";
    let shared = 0;
    sets.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      for (const word of mine) if (other.has(word)) shared += 1;
    });
    if (shared >= 2) return "match";
    if (shared === 1) return "close";
    return "unique";
  });
}

function placeOverlap(values: string[]): Overlap[] {
  const norm = values.map((value) => value.trim().toLowerCase());
  return norm.map((value, index) => {
    if (!value) return "empty";
    let best: Overlap = "unique";
    norm.forEach((other, otherIndex) => {
      if (otherIndex === index || !other) return;
      if (value === other || value.includes(other) || other.includes(value)) {
        best = "match";
        return;
      }
      const miles = milesBetweenPlaces(value, other);
      if (miles != null && miles <= 25) best = "match";
      else if (miles != null && miles <= 100 && best !== "match") best = "close";
      else if (shareToken(value, other) && best === "unique") best = "close";
    });
    return best;
  });
}

function shareToken(a: string, b: string) {
  const left = tokens(a);
  for (const word of tokens(b)) if (left.has(word)) return true;
  return false;
}

function milesBetweenPlaces(a: string, b: string) {
  const left = parseCoordinates(a);
  const right = parseCoordinates(b);
  if (!left || !right) return null;
  return metersBetween(left, right) / 1609.344;
}

function stampMs(raw: string) {
  const text = raw.trim();
  if (!text) return Number.NaN;
  return Date.parse(text.length === 10 ? `${text}T12:00:00` : text);
}

export function timelineGaps(cases: CaseRecord[]) {
  const notes: string[] = [];
  for (let i = 0; i < cases.length; i += 1) {
    for (let j = i + 1; j < cases.length; j += 1) {
      const a = cases[i];
      const b = cases[j];
      const missing = [stampMs(missingStamp(a)), stampMs(missingStamp(b))].filter((n) => Number.isFinite(n));
      const recovered = [stampMs(recoveryStamp(a)), stampMs(recoveryStamp(b))].filter((n) => Number.isFinite(n));
      const leftName = a.subjectName || a.title;
      const rightName = b.subjectName || b.title;
      if (missing.length && recovered.length) {
        const start = Math.min(...missing);
        const end = Math.max(...recovered);
        const days = Math.round((end - start) / 86400000);
        notes.push(`${leftName} and ${rightName}: ${Math.abs(days)} days between the earliest missing date and the latest recovery date.`);
      } else if (missing.length === 2) {
        const days = Math.abs(Math.round((missing[0] - missing[1]) / 86400000));
        notes.push(`${leftName} and ${rightName}: missing dates are ${days} days apart. Neither case has a recovery date yet.`);
      } else {
        notes.push(`${leftName} and ${rightName}: add a missing date and a recovery date to measure the gap.`);
      }
    }
  }
  return notes;
}
