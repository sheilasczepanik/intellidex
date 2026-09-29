const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

export type ParseEventTimeOpts = {
  extraText?: string;
  anchorMs?: number;
};

type Ymd = { y: number; m: number; d: number };
type Clock = { hours: number; minutes: number };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function localDayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function splitLocalDateTime(ts: number) {
  const d = new Date(ts);
  return {
    date: localDayKey(ts),
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

export function joinLocalDateTime(date: string, time: string) {
  const ts = Date.parse(`${date}T${time}`);
  return Number.isNaN(ts) ? null : ts;
}

function yearFromAnchor(anchorMs?: number) {
  return anchorMs != null ? new Date(anchorMs).getFullYear() : new Date().getFullYear();
}

function parseCalendarDate(source: string, anchorMs?: number): Ymd | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(source);
  if (iso) {
    return { y: Number(iso[1]), m: Number(iso[2]) - 1, d: Number(iso[3]) };
  }

  const named = new RegExp(
    `(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
    "i",
  ).exec(source);
  if (named) {
    const m = MONTHS[named[1].toLowerCase()];
    if (m != null) {
      return { y: named[3] ? Number(named[3]) : yearFromAnchor(anchorMs), m, d: Number(named[2]) };
    }
  }

  const namedRev = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?/i.exec(source);
  if (namedRev) {
    const m = MONTHS[namedRev[2].toLowerCase()];
    if (m != null) {
      return { y: namedRev[3] ? Number(namedRev[3]) : yearFromAnchor(anchorMs), m, d: Number(namedRev[1]) };
    }
  }

  const us = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(source);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    return { y, m: Number(us[1]) - 1, d: Number(us[2]) };
  }

  return null;
}

function parseClock(source: string): Clock | null {
  const between = /between\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s+and/i.exec(source);
  const clock = between ?? /(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i.exec(source);
  if (!clock) return null;
  let hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  const mer = (clock[3] ?? "").toLowerCase();
  if (mer.startsWith("p") && hours < 12) hours += 12;
  if (mer.startsWith("a") && hours === 12) hours = 0;
  return { hours, minutes };
}

function applyParts(date: Ymd, clock: Clock | null) {
  const hours = clock?.hours ?? 12;
  const minutes = clock?.minutes ?? 0;
  return new Date(date.y, date.m, date.d, hours, minutes, 0, 0).getTime();
}

/** Parse an extracted clock/date into a millisecond timestamp. Never defaults to Feb 14. */
export function parseEventTime(iso: string | null, label: string, opts: ParseEventTimeOpts = {}) {
  const extra = opts.extraText ?? "";
  const source = `${iso ?? ""} ${label} ${extra}`;
  const isoTrim = (iso ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(isoTrim)) {
    const fromIso = Date.parse(isoTrim.length === 10 ? `${isoTrim}T12:00:00` : isoTrim);
    if (!Number.isNaN(fromIso)) {
      const clock = parseClock(source);
      if (clock && isoTrim.length <= 10) return applyParts(parseCalendarDate(isoTrim)!, clock);
      return fromIso;
    }
  }

  const date = parseCalendarDate(source, opts.anchorMs);
  const clock = parseClock(source);

  if (date) return applyParts(date, clock);

  if (clock) {
    const anchor = opts.anchorMs != null ? new Date(opts.anchorMs) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), clock.hours, clock.minutes, 0, 0).getTime();
  }

  if (opts.anchorMs != null) return opts.anchorMs;
  return Date.now();
}

export function namesLooselyMatch(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const ta = norm(a);
  const tb = norm(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  if (ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1]) return true;
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  if (ta[0] === tb[0] && lastA.length >= 4 && lastB.length >= 4) {
    const stemA = lastA.slice(0, 4);
    const stemB = lastB.slice(0, 4);
    if (lastA.startsWith(stemB) || lastB.startsWith(stemA)) return true;
  }
  return false;
}
