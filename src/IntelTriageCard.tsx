import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Radio, ShieldAlert, X } from "lucide-react";
import { checkIntelConflict, type IntelConflictResult } from "./lib/intelConflict";
import type { ExternalIntelLead, IntelClaim, IntelSourceType } from "./types";
import type { TimelineEventRecord } from "./db";

const mono = "font-mono";

export const INTEL_SOURCE_LABELS: Record<IntelSourceType, string> = {
  forum_tip: "Forum tip",
  news_report: "News report",
  scanner_audio: "Scanner audio",
  witness_lead: "Witness lead",
  foia_document: "FOIA document",
  other: "Other",
};

const CATEGORY_TONE: Record<IntelClaim["category"], string> = {
  person: "border-blue-200 bg-blue-50 text-blue-800",
  vehicle: "border-amber-200 bg-amber-50 text-amber-800",
  location: "border-emerald-200 bg-emerald-50 text-emerald-800",
  alibi: "border-violet-200 bg-violet-50 text-violet-800",
  sighting: "border-sky-200 bg-sky-50 text-sky-800",
  evidence: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatWhen(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Props = {
  lead: ExternalIntelLead;
  events: TimelineEventRecord[];
  expanded: boolean;
  onToggle: () => void;
  onPromote: (claim: IntelClaim) => void | Promise<void>;
  onDismiss: (claim: IntelClaim) => void | Promise<void>;
};

export default function IntelTriageCard({
  lead,
  events,
  expanded,
  onToggle,
  onPromote,
  onDismiss,
}: Props) {
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const [conflicts, setConflicts] = useState<Record<string, IntelConflictResult>>({});
  const pending = lead.claims.filter((c) => c.triageStatus === "pending");
  const dismissed = lead.claims.filter((c) => c.triageStatus === "dismissed");
  const promoted = lead.claims.filter((c) => c.triageStatus === "promoted");

  return (
    <article className="overflow-hidden rounded-[12px] border border-slate-200 bg-white">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-slate-50/80">
        <div className="mt-0.5 text-slate-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
          <Radio className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-slate-900">{lead.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-slate-600`}>
              {INTEL_SOURCE_LABELS[lead.sourceType].toUpperCase()}
            </span>
            <span className="text-[11.5px] text-slate-500">{formatWhen(lead.createdAt)}</span>
            <span className={`inline-flex rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.06em] ${lead.claims.length ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
              Claims Extracted ({lead.claims.length})
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4">
          {lead.sourceUrl && (
            <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="mb-3 inline-block max-w-full truncate font-mono text-[11px] text-blue-700 hover:underline">
              {lead.sourceUrl}
            </a>
          )}
          <p className="mb-4 line-clamp-4 text-[12.5px] leading-relaxed text-slate-500">{lead.rawContent}</p>

          {pending.length === 0 && promoted.length === 0 && dismissed.length === 0 && (
            <p className="text-[13px] text-slate-500">No discrete claims were parsed. You can still keep the raw tip on file.</p>
          )}

          <div className="grid gap-2.5">
            {pending.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                conflict={conflicts[claim.id]}
                onPromote={() => void onPromote(claim)}
                onDismiss={() => void onDismiss(claim)}
                onCheck={() => setConflicts((c) => ({ ...c, [claim.id]: checkIntelConflict(claim, events) }))}
              />
            ))}
            {promoted.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} muted />
            ))}
          </div>

          {dismissed.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setDismissedOpen((v) => !v)}
                className={`${mono} text-[11px] tracking-[0.08em] text-slate-500 hover:text-slate-800`}
              >
                {dismissedOpen ? "▾" : "▸"} Dismissed Noise ({dismissed.length})
              </button>
              {dismissedOpen && (
                <div className="mt-2 grid gap-2">
                  {dismissed.map((claim) => (
                    <ClaimRow key={claim.id} claim={claim} muted />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function ClaimRow({
  claim,
  muted,
  conflict,
  onPromote,
  onDismiss,
  onCheck,
}: {
  claim: IntelClaim;
  muted?: boolean;
  conflict?: IntelConflictResult;
  onPromote?: () => void;
  onDismiss?: () => void;
  onCheck?: () => void;
}) {
  const faded = muted || claim.triageStatus === "dismissed";
  return (
    <div className={`rounded-[10px] border border-slate-200 bg-slate-50/70 p-3 ${faded ? "opacity-50" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] ${CATEGORY_TONE[claim.category]}`}>
          [{claim.category.toUpperCase()}]
        </span>
        {claim.extractedTimestamp && (
          <span className="text-[11px] text-slate-500">{claim.extractedTimestamp}</span>
        )}
        {claim.triageStatus === "promoted" && (
          <span className="text-[11px] font-medium text-emerald-700">Promoted to Verify</span>
        )}
      </div>
      <div className="text-[13.5px] font-medium text-slate-800">{claim.claimText}</div>
      <blockquote className="mt-1.5 border-l-2 border-amber-300 pl-2.5 text-[12.5px] italic text-slate-600">
        “{claim.verbatimQuote}”
      </blockquote>
      {conflict && (
        <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-[12px] ${
          conflict.status === "tension" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600"
        }`}>
          {conflict.message}
          {conflict.eventTitles.length > 0 && (
            <div className="mt-1 text-[11px] text-slate-500">vs {conflict.eventTitles.join(" · ")}</div>
          )}
        </div>
      )}
      {onPromote && onDismiss && onCheck && claim.triageStatus === "pending" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPromote}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-[12px] font-semibold text-white hover:bg-blue-700"
          >
            <Check className="h-3 w-3" />Keep & Promote to Verify Queue
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-[12px] font-medium text-slate-600 hover:bg-white"
          >
            <X className="h-3 w-3" />Dismiss as Noise
          </button>
          <button
            type="button"
            onClick={onCheck}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-[12px] font-medium text-amber-800 hover:bg-amber-100"
          >
            <ShieldAlert className="h-3 w-3" />Check Conflict
          </button>
        </div>
      )}
    </div>
  );
}
