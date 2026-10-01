import type { ReactNode } from "react";
import { Check, Pencil, Pin, X } from "lucide-react";
import EvidenceThumb from "./EvidenceThumb";
import { VerifyCategoryBadge, VerifyConfidenceChip, ManualObservationBadge, AiExtractedBadge } from "./Verify";
import { CitationPill } from "./SourceDocumentViewer";
import type { EntityRecord, EvidenceRecord, VerifyDraftRecord } from "./db";
import { evidenceImageSrc } from "./lib/imageEvidence";
import { inferSourceType, type SourceCitation } from "./types";

const mono = "font-mono";

function Chip({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
      {children}
    </span>
  );
}

export function citationFromDraft(draft: VerifyDraftRecord, evidence?: EvidenceRecord | null): SourceCitation {
  if (draft.sourceCitation?.exactQuote) {
    return {
      ...draft.sourceCitation,
      sourceId: evidence?.id || draft.sourceCitation.sourceId || draft.evidenceId,
      sourceName: evidence?.fileName || draft.sourceCitation.sourceName,
      sourceType: draft.sourceCitation.sourceType === "external_intel"
        ? "external_intel"
        : (evidence ? inferSourceType(evidence) : draft.sourceCitation.sourceType),
      sourceUrl: evidence?.sourceUrl || draft.sourceCitation.sourceUrl,
      sourceHash: draft.sourceCitation.sourceHash,
    };
  }
  return {
    sourceId: draft.evidenceId,
    sourceName: evidence?.fileName || "Source",
    sourceType: evidence ? inferSourceType(evidence) : "text",
    exactQuote: draft.snippet,
    sourceUrl: evidence?.sourceUrl,
  };
}

export function citationFromEvent(event: { sourceDocId?: string; description?: string; sourceCitation?: SourceCitation }, evidence?: EvidenceRecord | null): SourceCitation {
  if (event.sourceCitation?.exactQuote || event.sourceCitation?.sourceId) {
    return {
      ...event.sourceCitation,
      sourceId: evidence?.id || event.sourceCitation.sourceId || event.sourceDocId || "",
      sourceName: evidence?.fileName || event.sourceCitation.sourceName,
      sourceType: evidence ? inferSourceType(evidence) : event.sourceCitation.sourceType,
      exactQuote: event.sourceCitation.exactQuote || event.description || "",
      sourceUrl: evidence?.sourceUrl || event.sourceCitation.sourceUrl,
    };
  }
  return {
    sourceId: event.sourceDocId || evidence?.id || "",
    sourceName: evidence?.fileName || "Source",
    sourceType: evidence ? inferSourceType(evidence) : "text",
    exactQuote: (event.description || "").replace(/^[“"]|[”"]$/g, ""),
    sourceUrl: evidence?.sourceUrl,
  };
}

type Props = {
  draft: VerifyDraftRecord;
  evidence?: EvidenceRecord | null;
  entity?: EntityRecord;
  active?: boolean;
  editing?: boolean;
  inputCls: string;
  categories: readonly string[];
  entities: EntityRecord[];
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onOpenCitation: (citation: SourceCitation) => void;
  onConfirm: () => void;
  onReject: () => void;
  onEdit: () => void;
  onDoneEdit: () => void;
  onPatch: (patch: Partial<VerifyDraftRecord>) => void;
  parseEventTime: (a: null, label: string, opts: { extraText: string }) => number;
  pinned?: boolean;
  onTogglePin?: () => void;
};

export default function VerifyQueueCard({
  draft: d,
  evidence,
  entity,
  active,
  editing,
  inputCls,
  categories,
  entities,
  onHoverStart,
  onHoverEnd,
  onOpenCitation,
  onConfirm,
  onReject,
  onEdit,
  onDoneEdit,
  onPatch,
  parseEventTime,
  pinned,
  onTogglePin,
}: Props) {
  const thumb = evidenceImageSrc(evidence);
  const citation = citationFromDraft(d, evidence);
  return (
    <article
      id={`verify-card-${d.id}`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      className={`rounded-[14px] border p-4 transition-all duration-200 ${active ? "-translate-x-[3px] border-amber-400 bg-amber-50 ring-2 ring-amber-500/50" : "border-slate-200 bg-white shadow-sm"}`}
    >
      {editing ? (
        <div className="flex flex-col gap-2.5">
          <select value={d.category || "evidence"} onChange={(e) => onPatch({ category: e.target.value as VerifyDraftRecord["category"] })}
            className={`${inputCls} h-9 text-[13px]`}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={d.timestampLabel} onChange={(e) => onPatch({ timestampLabel: e.target.value, timestamp: parseEventTime(null, e.target.value, { extraText: `${d.details} ${d.snippet} ${d.citation}` }) })}
            className={`${inputCls} h-9 text-[13px]`} />
          <select value={d.entityId} onChange={(e) => {
            const ent = entities.find((x) => x.id === e.target.value);
            onPatch({ entityId: e.target.value, entityName: ent?.name ?? d.entityName });
          }} className={`${inputCls} h-9 text-[13px]`}>
            <option value="">New: {d.entityName}</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input value={d.title} onChange={(e) => onPatch({ title: e.target.value })} className={`${inputCls} h-9 text-[13px]`} />
          <textarea value={d.snippet} onChange={(e) => onPatch({ snippet: e.target.value })} className={`${inputCls} h-[72px] resize-none py-2 text-[12.5px]`} />
          <button type="button" onClick={onDoneEdit} className="self-end text-[12px] font-medium text-blue-600">Done</button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {thumb ? <EvidenceThumb src={thumb} alt={evidence?.fileName || d.title} className="h-12 w-[4.5rem]" /> : null}
            {d.origin === "manual" || d.citation === "manual-observation" || d.citation === "selection" || d.citation === "visual-selection"
              ? <ManualObservationBadge />
              : <AiExtractedBadge />}
            {d.category ? <VerifyCategoryBadge category={d.category} /> : null}
            <span className={`${mono} text-[12.5px] tracking-wide text-slate-900`}>{d.timestampLabel}</span>
            <Chip ok={Boolean(entity)}>{entity ? entity.name : d.entityName}</Chip>
            {onTogglePin && (entity?.type === "person" || d.entityId) ? (
              <button
                type="button"
                aria-label={pinned ? "Unpin person" : "Pin person"}
                onClick={onTogglePin}
                className={`flex h-7 w-7 items-center justify-center rounded-md ${pinned ? "text-blue-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}
              >
                <Pin className={`h-3.5 w-3.5 ${pinned ? "fill-blue-600" : ""}`} />
              </button>
            ) : null}
            {d.origin === "manual" || d.citation === "manual-observation" ? null : <VerifyConfidenceChip confidence={d.confidence} />}
          </div>
          <h3 className="mb-1.5 text-[14.5px] font-medium tracking-tight">{d.title}</h3>
          {d.details ? <p className="mb-2 text-[12px] leading-relaxed text-slate-600">{d.details}</p> : null}
          <button
            type="button"
            onClick={() => onOpenCitation(citation)}
            className="mb-2 block w-full text-left text-[12.5px] leading-relaxed text-slate-500 text-pretty hover:text-slate-800"
          >
            “{d.snippet}”
          </button>
          <div className="mb-3.5">
            <CitationPill citation={citation} onClick={() => onOpenCitation(citation)} />
          </div>
          <div className="flex items-center gap-2">
            {d.status === "confirmed" ? (
              <span className={`${mono} text-[10.5px] tracking-[0.08em] text-emerald-700`}>SAVED TO CASE</span>
            ) : (
              <>
                <button onClick={onConfirm}
                  className="inline-flex h-[30px] items-center gap-2 rounded-lg border border-blue-300 bg-blue-600/5 px-3 text-[12.5px] font-medium text-blue-700 transition-colors hover:bg-blue-600/15">
                  <Check className="h-3.5 w-3.5" />Confirm
                </button>
                <button onClick={onReject}
                  className="inline-flex h-[30px] items-center gap-2 rounded-lg border border-slate-300 px-3 text-[12.5px] text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">
                  <X className="h-3.5 w-3.5" />Reject
                </button>
              </>
            )}
            <button onClick={onEdit}
              className="inline-flex h-[30px] items-center gap-2 rounded-lg border border-slate-300 px-3 text-[12.5px] text-slate-500 hover:text-slate-900">
              <Pencil className="h-3.5 w-3.5" />Edit
            </button>
            <div className="flex-1" />
            <span className={`${mono} text-[10.5px] text-slate-500`}>{d.newEntityType || d.citation || "AI"}</span>
          </div>
        </>
      )}
    </article>
  );
}
