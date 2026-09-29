import type { IntelClaim } from "../types";
import type { TimelineEventRecord } from "../db/schema";
import { parseEventTime } from "./eventTime";

export type IntelConflictResult = {
  status: "clear" | "tension" | "none";
  message: string;
  eventTitles: string[];
};

const STOP = new Set(["this", "that", "with", "from", "have", "been", "were", "they", "them", "said", "also", "into", "about", "would", "could"]);

function tokens(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
}

export function checkIntelConflict(claim: IntelClaim, events: TimelineEventRecord[]): IntelConflictResult {
  const verified = events.filter((e) => e.isVerified);
  if (!verified.length) {
    return { status: "none", message: "No verified timeline facts to compare yet.", eventTitles: [] };
  }

  const ts = parseEventTime(claim.extractedTimestamp ?? null, claim.extractedTimestamp || "", {
    extraText: `${claim.claimText} ${claim.verbatimQuote}`,
  });
  const windowMs = 8 * 60 * 60 * 1000;
  const nearby = verified.filter((e) => Math.abs(e.timestamp - ts) <= windowMs);
  const claimTok = new Set(tokens(`${claim.claimText} ${claim.verbatimQuote}`));

  if (!nearby.length) {
    return {
      status: "clear",
      message: "No verified events sit in the same time window as this claim.",
      eventTitles: [],
    };
  }

  const overlapping = nearby.filter((e) => tokens(`${e.title} ${e.description}`).some((t) => claimTok.has(t)));
  if (claim.category === "alibi" && nearby.length && overlapping.length === 0) {
    return {
      status: "tension",
      message: "Alibi claim sits in the same window as verified activity that does not mention this account.",
      eventTitles: nearby.slice(0, 3).map((e) => e.title),
    };
  }
  if (nearby.length && overlapping.length === 0) {
    return {
      status: "tension",
      message: "Verified events exist in this time window but do not share named facts with the tip.",
      eventTitles: nearby.slice(0, 3).map((e) => e.title),
    };
  }
  return {
    status: "clear",
    message: overlapping.length
      ? "Nearby verified events mention overlapping details. Review before promoting."
      : "No contradiction detected against verified timeline facts.",
    eventTitles: overlapping.slice(0, 3).map((e) => e.title),
  };
}
