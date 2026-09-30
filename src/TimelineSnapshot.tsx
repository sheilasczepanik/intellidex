import type { CaseRecord, EvidenceRecord, TimelineEventRecord } from "./db";
import {
  bucketTimelineEvent,
  formatSnapshotDate,
  formatSnapshotTime,
  parseLksTimestamp,
} from "./lib/missingPerson";
import { isSecondaryEvidence } from "./lib/sourceTier";

const mono = "font-mono";

function DateColumn({ ts, lksPin }: { ts: number | null; lksPin?: boolean }) {
  return (
    <div className="w-[140px] shrink-0 pr-3">
      <div className={`${mono} text-[11.5px] font-bold tracking-[0.12em] text-slate-900`}>
        {ts != null ? formatSnapshotDate(ts) : "DATE UNKNOWN"}
      </div>
      <div className="mt-0.5 text-[11.5px] text-slate-500">{ts != null ? formatSnapshotTime(ts) : "Time unknown"}</div>
      {lksPin ? (
        <span className={`mt-1.5 inline-flex rounded-md border border-amber-400 bg-amber-50 px-1.5 py-0.5 ${mono} text-[9px] font-semibold tracking-[0.14em] text-amber-950`}>
          LKS PIN
        </span>
      ) : null}
    </div>
  );
}

function SnapshotRow({
  title,
  summary,
  ts,
  lksPin,
  highlight,
  secondary,
  citeUrl,
  sourceTag,
}: {
  title: string;
  summary: string;
  ts: number | null;
  lksPin?: boolean;
  highlight?: boolean;
  secondary?: boolean;
  citeUrl?: string;
  sourceTag?: string;
}) {
  return (
    <div className={`flex gap-0 rounded-[10px] px-2 py-2 ${highlight ? "border border-amber-400 bg-amber-50" : secondary ? "border border-dashed border-amber-400 bg-amber-50/50" : "border border-transparent"}`}>
      <DateColumn ts={ts} lksPin={lksPin} />
      <div className="relative min-w-0 flex-1 border-l border-slate-200 pl-4">
        <span className={`absolute top-2 left-[-4.5px] h-[9px] w-[9px] rounded-full border-2 bg-white ${highlight ? "border-amber-500" : "border-slate-400"}`} />
        <div className="truncate text-[13.5px] font-medium text-slate-900">{title}</div>
        <div className="truncate text-[12px] text-slate-600">{summary}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {sourceTag ? (
            <span className={`rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] ${sourceTag === "Manual Observation" ? "border-violet-200 bg-violet-50 text-violet-800" : secondary ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-600"}`}>
              {sourceTag}
            </span>
          ) : null}
          {citeUrl ? (
            <a href={citeUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[11.5px] font-semibold text-amber-950 underline">
              Source / citation
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function TimelineSnapshot({
  activeCase,
  events,
  evidence,
  onOpenTimeline,
}: {
  activeCase: CaseRecord;
  events: TimelineEventRecord[];
  evidence: EvidenceRecord[];
  onOpenTimeline: () => void;
}) {
  const snapshot = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const lksMs = parseLksTimestamp(activeCase);
  const buckets = {
    pre: snapshot.filter((ev) => bucketTimelineEvent(ev, lksMs) === "pre"),
    lks: snapshot.filter((ev) => bucketTimelineEvent(ev, lksMs) === "lks"),
    search: snapshot.filter((ev) => bucketTimelineEvent(ev, lksMs) === "search"),
  };

  const renderRow = (ev: TimelineEventRecord, highlight?: boolean) => {
    const src = evidence.find((row) => row.id === ev.sourceDocId);
    const secondary = ev.tier === "secondary" || Boolean(src && isSecondaryEvidence(src));
    const citeUrl = ev.sourceCitation?.sourceUrl || src?.sourceUrl;
    const sourceTag = ev.origin === "manual" ? "Manual Observation" : secondary ? "Tier 2" : "Tier 1";
    return (
      <SnapshotRow
        key={ev.id}
        title={ev.title}
        summary={ev.description}
        ts={ev.timestamp}
        lksPin={highlight}
        highlight={highlight}
        secondary={secondary}
        citeUrl={citeUrl}
        sourceTag={sourceTag}
      />
    );
  };

  return (
    <div className="mb-8">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>TIMELINE SNAPSHOT</h2>
        <button type="button" onClick={onOpenTimeline} className={`${mono} text-[11px] text-blue-700 hover:underline`}>OPEN CHRONOLOGY</button>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenTimeline}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenTimeline(); } }}
        className="w-full cursor-pointer rounded-[14px] border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300"
      >
        <div className="flex flex-col gap-5">
          <div>
            <div className={`mb-2 ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>PRE-DISAPPEARANCE TIMELINE</div>
            {buckets.pre.length ? buckets.pre.slice(0, 4).map((ev) => renderRow(ev)) : <p className="text-[13px] text-slate-500">No pre-disappearance events plotted.</p>}
          </div>
          <div>
            <div className={`mb-2 ${mono} text-[10px] tracking-[0.12em] text-amber-950`}>LAST KNOWN SIGHTING (LKS)</div>
            {buckets.lks.length ? buckets.lks.map((ev) => renderRow(ev, true)) : (
              <SnapshotRow
                title="Last Known Sighting"
                summary={`${activeCase.lksLocation || activeCase.jurisdiction || "Location unassigned"}${activeCase.lksCircumstances ? ` — ${activeCase.lksCircumstances}` : ""}`}
                ts={lksMs}
                lksPin
                highlight
                sourceTag="Case record"
              />
            )}
          </div>
          <div>
            <div className={`mb-2 ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>SEARCH OPERATIONS, VERIFIED SIGHTINGS & TIPS</div>
            {buckets.search.length ? buckets.search.slice(0, 6).map((ev) => renderRow(ev)) : <p className="text-[13px] text-slate-500">No search events yet. Confirm facts in Verify.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
