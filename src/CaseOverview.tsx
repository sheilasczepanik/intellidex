import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowRight, Check, Clock, Copy, Download, Eye, FileAudio, FileDown, FileText, Globe, Image as ImageIcon,
  MapPin, MoreHorizontal, Pencil, Phone, Plus, Radio, RefreshCw, Trash2, Upload,
} from "lucide-react";
import {
  CONTACT_AFFILIATIONS, createCaseContact, db, deleteCaseContact, deleteEvidence, formatBytes,
  updateCaseContact,
  type CaseContactRecord, type CaseRecord,
  type EntityRecord, type EvidenceRecord, type TimelineEventRecord, type VerifyDraftRecord,
} from "./db";
import ArchiveCaseModal from "./ArchiveCaseModal";
import IngestDrawer, { type ExtractPreview } from "./IngestDrawer";
import Sha256Badge from "./Sha256Badge";
import SourceDocumentViewer from "./SourceDocumentViewer";
import { ingestElapsedSec, type IngestJob } from "./lib/ingestProgress";
import { entityAvatarClass, entityInitials, formatRoleLabel, isVictimOrDeceased } from "./utils/roleBadge";
import {
  formatElapsedCompact,
  formatLocationKindLabel,
  inferSearchLocationKind,
  inferSearchStatus,
  isOpenTip,
  isVerifiedSighting,
  parseLksTimestamp,
  searchStatusClass,
} from "./lib/missingPerson";
import SubjectProfile from "./SubjectProfile";
import TimelineSnapshot from "./TimelineSnapshot";
import { isSecondaryEvidence, sourceClassLabel } from "./lib/sourceTier";

const mono = "font-mono";

function initials(name: string) {
  return entityInitials(name);
}

function isLivingRolodexContact(contact: CaseContactRecord, entities: EntityRecord[]) {
  if (/\b(deceased|decedent)\b/i.test(`${contact.notes} ${contact.affiliation}`)) return false;
  if (/^victim$/i.test(contact.affiliation.trim())) return false;
  if (/missing person/i.test(contact.affiliation)) return false;
  const linked = contact.entityId ? entities.find((e) => e.id === contact.entityId) : undefined;
  if (linked) {
    if (linked.type !== "person") return false;
    if (isVictimOrDeceased(linked.role, linked.notes, linked.classification)) return false;
    return true;
  }
  const named = entities.find((e) => e.type === "person" && e.name.trim().toLowerCase() === contact.name.trim().toLowerCase());
  if (named && isVictimOrDeceased(named.role, named.notes, named.classification)) return false;
  return true;
}

function uniqueEvidence(rows: EvidenceRecord[]) {
  const byId = new Map<string, EvidenceRecord>();
  for (const row of rows) byId.set(row.id, row);
  const unique = [...byId.values()];
  const byHash = new Map<string, EvidenceRecord>();
  const noHash: EvidenceRecord[] = [];
  for (const row of unique) {
    const hash = (row.sha256Hash || "").toLowerCase();
    if (!hash) {
      noHash.push(row);
      continue;
    }
    const prev = byHash.get(hash);
    if (!prev || (row.ingestedAt || "") > (prev.ingestedAt || "")) byHash.set(hash, row);
  }
  return [...byHash.values(), ...noHash];
}

function formatStamp(ts: number) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sourceKind(ev: EvidenceRecord): "PDF" | "TXT" | "DOCX" | "JPG/PNG" | "AUDIO" | "WEB" {
  if (isSecondaryEvidence(ev) || ev.sourceType === "web_article" || ev.fileType === "web_article") return "WEB";
  const blob = `${ev.sourceType || ""} ${ev.fileType || ""} ${ev.mediaType || ""} ${ev.fileName || ""}`.toLowerCase();
  if (/\.(mp3|wav|m4a|aac|ogg)|audio\//.test(blob)) return "AUDIO";
  if (/\.(docx?|rtf)|wordprocessing|msword/.test(blob)) return "DOCX";
  if (ev.sourceType === "image" || /image\/|\.(png|jpe?g|webp|gif)$/.test(blob)) return "JPG/PNG";
  if (ev.sourceType === "pdf" || blob.includes("pdf")) return "PDF";
  return "TXT";
}

function ingestLabel(status: EvidenceRecord["status"]): { text: "Indexed" | "Processing" | "Needs Review"; cls: string } {
  if (status === "indexed") return { text: "Indexed", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  if (status === "ingesting" || status === "queued") return { text: "Processing", cls: "border-blue-200 bg-blue-50 text-blue-800" };
  return { text: "Needs Review", cls: "border-amber-200 bg-amber-50 text-amber-900" };
}

function SourceKindIcon({ kind }: { kind: ReturnType<typeof sourceKind> }) {
  const wrap = "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500";
  if (kind === "JPG/PNG") return <div className={wrap}><ImageIcon className="h-4 w-4" /></div>;
  if (kind === "AUDIO") return <div className={wrap}><FileAudio className="h-4 w-4" /></div>;
  if (kind === "WEB") return <div className={wrap}><Globe className="h-4 w-4" /></div>;
  return <div className={wrap}><FileText className="h-4 w-4" /></div>;
}

function downloadOriginal(ev: EvidenceRecord) {
  const name = ev.originalFileName || ev.fileName || "source";
  const data = ev.fileBase64 || ev.imageBase64;
  if (data) {
    const a = document.createElement("a");
    a.href = data.startsWith("data:") ? data : `data:application/octet-stream;base64,${data}`;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  if (ev.rawText) {
    const url = URL.createObjectURL(new Blob([ev.rawText], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export default function CaseOverview({
  activeCase,
  entities,
  evidence,
  events,
  pendingCount,
  conflictCount: _conflictCount,
  onOpenTimeline,
  onOpenLocations,
  onInspectContradiction: _onInspectContradiction,
  onOpenEntity,
  onAddEvidence,
  onLogTip,
  onDropFiles,
  onArchiveCase,
  onUnarchiveCase,
  onExportDossier,
  canExport = true,
  onInspectSource,
  onReextract,
  ingestJob,
  nowMs,
  extractNotice,
  extractError,
  onIngestUrl,
  onIngestPaste,
  extractPreview,
  selectedExtractNames,
  onToggleExtractName,
  onExtractEvidence,
  onAcceptExtract,
  stagedEvidence,
}: {
  activeCase: CaseRecord | null;
  entities: EntityRecord[];
  evidence: EvidenceRecord[];
  events: TimelineEventRecord[];
  pendingCount: number;
  conflictCount?: number;
  onOpenTimeline: () => void;
  onOpenLocations?: () => void;
  onInspectContradiction?: () => void;
  onOpenEntity: (entity: EntityRecord) => void;
  onAddEvidence: () => void;
  onLogTip: () => void;
  onDropFiles: (files: FileList | File[]) => void | Promise<void>;
  onArchiveCase: () => void | Promise<void>;
  onUnarchiveCase: () => void;
  onExportDossier?: () => void;
  canExport?: boolean;
  onInspectSource?: (evidenceId: string) => void;
  onReextract?: (evidenceId: string) => void;
  ingestJob?: IngestJob | null;
  nowMs?: number;
  extractNotice?: { fileName: string; entityCount: number } | null;
  extractError?: string | null;
  onIngestUrl?: (url: string, onProgress: (stage: "scraping" | "staging") => void) => Promise<void>;
  onIngestPaste?: (text: string, kind?: "official" | "editorial") => void | Promise<void>;
  extractPreview?: ExtractPreview | null;
  selectedExtractNames?: Set<string>;
  onToggleExtractName?: (name: string) => void;
  onExtractEvidence?: (evidenceId: string) => void | Promise<void>;
  onAcceptExtract?: () => void | Promise<void>;
  stagedEvidence?: EvidenceRecord[];
}) {
  const [ingestBusy, setIngestBusy] = useState(false);

  const verifiedSightings = events.filter((e) => isVerifiedSighting(e));
  const openTips = events.filter((e) => isOpenTip(e)).length + pendingCount;
  const searchZones = useMemo(
    () => entities.filter((e) => e.type === "place"),
    [entities],
  );
  const locations = searchZones;

  const contacts = useLiveQuery(
    async () => {
      if (!activeCase) return [] as CaseContactRecord[];
      try {
        return await db.caseContacts.where("caseId").equals(activeCase.id).toArray();
      } catch {
        return [] as CaseContactRecord[];
      }
    },
    [activeCase?.id],
  ) ?? [];
  const [contactQuery, setContactQuery] = useState("");
  const [contactForm, setContactForm] = useState<null | Partial<CaseContactRecord> & { id?: string }>(null);
  const [copied, setCopied] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sourceMenuId, setSourceMenuId] = useState<string | null>(null);
  const [registryTab, setRegistryTab] = useState<"official" | "news">("official");
  const [ingestOpen, setIngestOpen] = useState(false);
  const [contactsExpanded, setContactsExpanded] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const verifyDrafts = useLiveQuery(
    async () => {
      if (!activeCase) return [] as VerifyDraftRecord[];
      try {
        return await db.verifyDrafts.where("caseId").equals(activeCase.id).toArray();
      } catch {
        return [] as VerifyDraftRecord[];
      }
    },
    [activeCase?.id],
  ) ?? [];

  const mentionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      if (!ev.sourceDocId) continue;
      map.set(ev.sourceDocId, (map.get(ev.sourceDocId) ?? 0) + 1);
    }
    for (const d of verifyDrafts) {
      map.set(d.evidenceId, (map.get(d.evidenceId) ?? 0) + 1);
    }
    return map;
  }, [events, verifyDrafts]);

  const uniqueSources = useMemo(() => uniqueEvidence(evidence), [evidence]);
  const officialSources = uniqueSources.filter((e) => !isSecondaryEvidence(e));
  const newsSources = uniqueSources.filter((e) => isSecondaryEvidence(e));
  const registryRows = registryTab === "official" ? officialSources : newsSources;

  useEffect(() => {
    if (!sourceMenuId) return;
    const close = () => setSourceMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sourceMenuId]);

  const livingContacts = useMemo(
    () => contacts.filter((c) => isLivingRolodexContact(c, entities)),
    [contacts, entities],
  );

  const visibleContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const pool = q
      ? livingContacts.filter((c) =>
        `${c.name} ${c.affiliation} ${c.phone} ${c.email} ${c.address} ${c.notes}`.toLowerCase().includes(q),
      )
      : livingContacts;
    return contactsExpanded ? pool : pool.slice(0, 4);
  }, [livingContacts, contactQuery, contactsExpanded]);
  const hiddenContactCount = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const pool = q
      ? livingContacts.filter((c) =>
        `${c.name} ${c.affiliation} ${c.phone} ${c.email} ${c.address} ${c.notes}`.toLowerCase().includes(q),
      )
      : livingContacts;
    return Math.max(0, pool.length - 4);
  }, [livingContacts, contactQuery]);

  const copyVal = async (key: string, value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1200);
  };

  const saveContact = async () => {
    if (!activeCase || !contactForm?.name?.trim()) return;
    const payload = {
      caseId: activeCase.id,
      name: contactForm.name ?? "",
      affiliation: contactForm.affiliation ?? "Other",
      entityId: contactForm.entityId ?? "",
      phone: contactForm.phone ?? "",
      email: contactForm.email ?? "",
      address: contactForm.address ?? "",
      notes: contactForm.notes ?? "",
    };
    if (contactForm.id) await updateCaseContact(contactForm.id, payload);
    else await createCaseContact(payload);
    setContactForm(null);
  };

  const onFiles = async (list: FileList | File[] | null) => {
    if (!list || (Array.isArray(list) ? list.length === 0 : list.length === 0)) return;
    setIngestBusy(true);
    try {
      await onDropFiles([...list]);
    } finally {
      setIngestBusy(false);
    }
  };

  const openReview = (id: string) => {
    setIngestOpen(true);
    onInspectSource?.(id);
  };

  if (!activeCase) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center px-4 pb-20 pt-24 text-center sm:px-6 lg:px-10">
        <h1 className="mb-3 text-[34px] font-semibold tracking-tight">No case selected</h1>
        <p className="max-w-[42ch] px-4 text-[14px] text-slate-500">Open a case from Hub or finish setup to land on the overview dashboard.</p>
      </div>
    );
  }

    return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-8 sm:px-6 sm:pt-10 lg:px-10">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>
            {activeCase.fileIdentifier || activeCase.id} / MISSING PERSON SEARCH
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {onExportDossier && (
            <button type="button" disabled={!canExport} onClick={onExportDossier}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 text-sm font-medium tracking-wide text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40">
              <FileDown className="h-3.5 w-3.5 text-slate-500" />Export pack
            </button>
          )}
          {activeCase.isArchived ? (
            <button type="button" onClick={onUnarchiveCase}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
              <ArchiveRestore className="h-3.5 w-3.5" />Unarchive Case
            </button>
          ) : null}
          <button type="button" onClick={onAddEvidence}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700">
            <Upload className="h-3.5 w-3.5" />Add Evidence
          </button>
          <button type="button" onClick={onLogTip}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-amber-400 bg-amber-50 px-4 text-[13px] font-semibold text-amber-950 hover:bg-amber-100">
            <Plus className="h-3.5 w-3.5" />Log Tip
          </button>
          <button type="button" onClick={onOpenTimeline}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-blue-600 hover:text-blue-700">
            View Full Timeline<ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <SubjectProfile activeCase={activeCase} clock={clock} />

      {(ingestJob && ingestJob.stage !== "done") || extractNotice ? (
        <div className="mb-6">
          {ingestJob && ingestJob.stage !== "done" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-950">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-700" />
              Analyzing evidence: {evidence.find((e) => e.id === ingestJob.evidenceId)?.fileName || "source"} ({ingestElapsedSec(ingestJob, nowMs ?? Date.now())}s elapsed)
            </span>
          )}
          {(!ingestJob || ingestJob.stage === "done") && extractNotice && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11.5px] font-medium text-white">
              <Check className="h-3 w-3" />
              Indexed {extractNotice.entityCount} {extractNotice.entityCount === 1 ? "record" : "records"} from {extractNotice.fileName}
            </span>
          )}
        </div>
      ) : null}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Time elapsed", value: formatElapsedCompact(parseLksTimestamp(activeCase), clock), icon: Clock, onClick: onOpenTimeline },
          { label: "Verified sightings", value: verifiedSightings.length, icon: Check, onClick: onOpenTimeline },
          { label: "Open tips & leads", value: openTips, icon: AlertTriangle, onClick: onLogTip },
          { label: "Search zones & pings", value: searchZones.length, icon: Radio, onClick: () => document.getElementById("overview-search-zones")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
        ].map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => stat.onClick()}
            className="cursor-pointer rounded-[14px] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-amber-400"
          >
            <div className="mb-3 flex items-center justify-between text-slate-500">
              <stat.icon className="h-4 w-4" />
              <span className={`${mono} text-[10px] tracking-[0.12em] text-slate-600`}>{stat.label.toUpperCase()}</span>
            </div>
            <div className="text-[28px] font-semibold tracking-tight text-slate-950">{stat.value}</div>
          </button>
        ))}
      </div>

      <div className="mb-8">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>INGESTED EVIDENCE & TIP VAULT</h2>
          <span className={`${mono} text-[11px] text-slate-400`}>{uniqueSources.length} FILES INDEXED</span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-[10px] border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setRegistryTab("official")}
            className={`rounded-[8px] px-2 py-2 text-[11px] font-semibold leading-snug sm:text-[12px] ${registryTab === "official" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            Official Records & Search Logs ({officialSources.length})
          </button>
          <button
            type="button"
            onClick={() => setRegistryTab("news")}
            className={`rounded-[8px] px-2 py-2 text-[11px] font-semibold leading-snug sm:text-[12px] ${registryTab === "news" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            Tips, Sightings & Media Archive ({newsSources.length})
          </button>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={registryTab === "official" ? onAddEvidence : onLogTip}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-blue-600 px-3 text-[12.5px] font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {registryTab === "official" ? "+ Add Evidence" : "+ Log Tip"}
            </button>
          </div>

          {registryRows.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-[13px] text-slate-500">
              {registryTab === "official"
                ? "No official records yet. Upload filings, NamUs extracts, SAR GPS logs, or verified cell records."
                : "No tips or media yet. Log a community tip, news clip, or social lead."}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-[10px] border border-slate-200">
              {registryRows.map((ev) => {
                const kind = sourceKind(ev);
                const badge = ingestLabel(ev.status);
                const refs = mentionCounts.get(ev.id) ?? 0;
                const stamp = ev.ingestedAt ? formatStamp(new Date(ev.ingestedAt).getTime()) : formatStamp(activeCase.updatedAt);
                const size = formatBytes(ev.byteSize ?? ev.fileSize);
                return (
                  <li key={ev.id} className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <SourceKindIcon kind={kind} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <div className="min-w-0 truncate text-[13.5px] font-semibold text-slate-900">{ev.originalFileName || ev.fileName}</div>
                          <span className={`rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-slate-600`}>
                            {kind}
                          </span>
                          {sourceClassLabel(ev.sourceClass) ? (
                            <span className={`rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] ${isSecondaryEvidence(ev) ? "border-amber-300 bg-amber-50 text-amber-900" : "text-slate-600"}`}>
                              {sourceClassLabel(ev.sourceClass)}
                            </span>
                          ) : null}
                          {isSecondaryEvidence(ev) ? (
                            <span className={`rounded-md border border-dashed border-amber-400 bg-amber-50 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-amber-950`}>
                              TIER 2 TIP
                            </span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-white`}>
                              ✓ TIER 1
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
                          <span>{stamp}</span>
                          {size ? <span>· {size}</span> : null}
                          <button
                            type="button"
                            onClick={() => openReview(ev.id)}
                            className={`rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.04em] ${badge.cls} ${badge.text === "Needs Review" ? "cursor-pointer hover:border-amber-400" : ""}`}
                          >
                            {badge.text}
                          </button>
                          {ev.sha256Hash ? <Sha256Badge hash={ev.sha256Hash} /> : null}
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">
                            {refs} {refs === 1 ? "reference" : "references"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setPreviewId(ev.id)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-medium text-slate-700 hover:border-slate-300"
                      >
                        <Eye className="h-3.5 w-3.5" /> Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => openReview(ev.id)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-medium text-slate-700 hover:border-slate-300"
                      >
                        Extracted Entities
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          aria-label="Source actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSourceMenuId((id) => (id === ev.id ? null : ev.id));
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {sourceMenuId === ev.id && (
                          <div
                            role="menu"
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 z-20 mt-1 w-[240px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                downloadOriginal(ev);
                                setSourceMenuId(null);
                              }}
                            >
                              <Download className="h-3.5 w-3.5" /> Download Original
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-slate-700 hover:bg-slate-50"
                              onClick={() => {
                                onReextract?.(ev.id);
                                setSourceMenuId(null);
                              }}
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Re-run Triage / Entity Extraction
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-rose-700 hover:bg-rose-50"
                              onClick={() => {
                                setSourceMenuId(null);
                                if (!window.confirm(`Disassociate “${ev.originalFileName || ev.fileName}” from this case?`)) return;
                                void deleteEvidence(ev.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete / Disassociate
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>SEARCH NETWORK & CONTACTS</h2>
            <span className={`${mono} text-[11px] text-slate-400`}>{livingContacts.length} LIVING</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Search contacts"
              className="h-8 w-[180px] rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setContactForm({ name: "", affiliation: "Lead Detective / Agency", entityId: "", phone: "", email: "", address: "", notes: "" })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12px] font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />Add Contact
            </button>
          </div>
        </div>

        {contactForm && (
          <div className="mb-3 rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                Full name
                <input value={contactForm.name ?? ""} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] font-normal outline-none focus:border-blue-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                Contact type / affiliation
                <select value={contactForm.affiliation ?? "Other"} onChange={(e) => setContactForm({ ...contactForm, affiliation: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] font-normal outline-none">
                  {CONTACT_AFFILIATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                Associated entity
                <select value={contactForm.entityId ?? ""} onChange={(e) => setContactForm({ ...contactForm, entityId: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] font-normal outline-none">
                  <option value="">None</option>
                  {entities.filter((e) => e.type === "person" && !isVictimOrDeceased(e.role, e.notes, e.classification)).map((e) => <option key={e.id} value={e.id}>{e.name} · {formatRoleLabel(e.role) || e.type}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                Phone
                <input value={contactForm.phone ?? ""} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] font-normal outline-none focus:border-blue-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                Email
                <input value={contactForm.email ?? ""} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] font-normal outline-none focus:border-blue-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 sm:col-span-2">
                Address / location
                <input value={contactForm.address ?? ""} onChange={(e) => setContactForm({ ...contactForm, address: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 px-2.5 text-[13px] font-normal outline-none focus:border-blue-500" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 sm:col-span-2">
                Operational notes
                <textarea value={contactForm.notes ?? ""} onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                  placeholder="e.g. Key holder for rear camera footage"
                  className="min-h-[64px] rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] font-normal outline-none focus:border-blue-500" />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setContactForm(null)} className="h-8 rounded-lg border border-slate-200 px-3 text-[12px] text-slate-600">Cancel</button>
              <button type="button" onClick={() => void saveContact()} disabled={!contactForm.name?.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12px] font-semibold text-white disabled:opacity-40">
                <Check className="h-3.5 w-3.5" />Save contact
              </button>
            </div>
          </div>
        )}

        {visibleContacts.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-[13px] text-slate-500">
            {livingContacts.length === 0
              ? "No living search-network contacts yet. The missing person is omitted from this list."
              : "No contacts match this search."}
          </div>
        ) : (
          <>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleContacts.map((c) => {
              const linked = entities.find((e) => e.id === c.entityId);
              const avatarRole = linked?.role;
              return (
                <div key={c.id} className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${entityAvatarClass(avatarRole, "bg-slate-50 text-slate-700 border border-slate-200", linked?.notes, linked?.classification)}`}>
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[14.5px] font-semibold">{c.name}</div>
                        <div className={`${mono} text-[10.5px] tracking-[0.04em] text-slate-500`}>{c.affiliation}</div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" aria-label="Edit contact" onClick={() => setContactForm(c)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" aria-label="Delete contact" onClick={() => void deleteCaseContact(c.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {linked && <div className="mb-2 text-[12px] text-slate-500">Linked · {linked.name}</div>}
                  <div className="flex flex-col gap-1.5 text-[12.5px] text-slate-600">
                    {c.phone && (
                      <button type="button" onClick={() => void copyVal(`${c.id}-phone`, c.phone)} className="inline-flex items-center gap-2 text-left hover:text-blue-700">
                        <Phone className="h-3.5 w-3.5 text-slate-400" />{c.phone}
                        <Copy className="h-3 w-3 text-slate-300" />
                        {copied === `${c.id}-phone` && <span className="text-[10px] text-emerald-600">Copied</span>}
                      </button>
                    )}
                    {c.email && (
                      <button type="button" onClick={() => void copyVal(`${c.id}-email`, c.email)} className="inline-flex items-center gap-2 text-left hover:text-blue-700">
                        <span className="w-3.5 text-center text-[11px] text-slate-400">@</span>{c.email}
                        <Copy className="h-3 w-3 text-slate-300" />
                        {copied === `${c.id}-email` && <span className="text-[10px] text-emerald-600">Copied</span>}
                      </button>
                    )}
                    {c.address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />{c.address}</div>}
                    {c.notes && <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{c.notes}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {!contactsExpanded && hiddenContactCount > 0 ? (
            <button
              type="button"
              onClick={() => setContactsExpanded(true)}
              className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700"
            >
              + See More ({hiddenContactCount})
            </button>
          ) : contactsExpanded && hiddenContactCount > 0 ? (
            <button
              type="button"
              onClick={() => setContactsExpanded(false)}
              className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-600 hover:border-slate-300"
            >
              Show fewer
            </button>
          ) : null}
          </>
        )}
      </div>

      <TimelineSnapshot
        activeCase={activeCase}
        events={events}
        evidence={evidence}
        onOpenTimeline={onOpenTimeline}
      />

      <div id="overview-search-zones" className="mb-8 scroll-mt-6">
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>KEY LOCATIONS, PINGS & SEARCH GRIDS</h2>
          <div className="flex items-center gap-3">
            <span className={`${mono} text-[11px] text-slate-400`}>{locations.length} ZONES</span>
            {onOpenLocations ? (
              <button type="button" onClick={onOpenLocations} className={`${mono} text-[11px] text-blue-700 hover:underline`}>OPEN MAP</button>
            ) : null}
          </div>
        </div>
        {locations.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-[13px] text-slate-500">
            No search locations yet. Extraction and intake will add last-seen points, pings, and grids.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {locations.map((loc) => {
              const kind = inferSearchLocationKind(loc);
              const status = inferSearchStatus(loc);
              const related = events
                .filter((ev) => ev.entityId === loc.id || `${ev.title} ${ev.description}`.toLowerCase().includes(loc.name.trim().toLowerCase()))
                .sort((a, b) => a.timestamp - b.timestamp);
              const area = loc.metadata?.address || loc.metadata?.coordinates || loc.metadata?.jurisdiction || loc.notes || activeCase.lksLocation || activeCase.jurisdiction?.trim() || "Address unassigned";
              const dateLabel = loc.metadata?.dateLogged || (related[0] ? formatStamp(related[0].timestamp) : "Date not logged");
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => onOpenEntity(loc)}
                  className="rounded-[14px] border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-amber-400"
                >
                  <div className="mb-2 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-slate-800">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{loc.name}</div>
                      <div className="mt-0.5 text-[12.5px] text-slate-600">{area}</div>
                    </div>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] ${searchStatusClass(status)}`}>
                      {status}
                    </span>
                  </div>
                  <div className={`mt-1 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-slate-600`}>{formatLocationKindLabel(kind)}</div>
                  <div className="mt-1 text-[12px] text-slate-600">Logged {dateLabel}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!activeCase.isArchived && (
        <section className="mt-10 border-t border-slate-200/60 pt-6 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-[13px] font-medium text-slate-400">Archive case</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">
                Move this investigation to the Archived tab on the Hub. You can restore it anytime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] bg-transparent px-3 text-[13px] font-medium text-slate-400 hover:bg-red-50/50 hover:text-red-600"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive Case
            </button>
          </div>
        </section>
      )}

      <ArchiveCaseModal
        open={archiveOpen}
        caseTitle={activeCase.title}
        onClose={() => setArchiveOpen(false)}
        onConfirm={async () => {
          await onArchiveCase();
          setArchiveOpen(false);
        }}
      />

      <IngestDrawer
        open={ingestOpen}
        busy={ingestBusy}
        error={extractError}
        staged={stagedEvidence ?? []}
        ingestJob={ingestJob}
        extractPreview={extractPreview ?? null}
        selectedNames={selectedExtractNames ?? new Set()}
        onToggleName={(name) => onToggleExtractName?.(name)}
        onClose={() => setIngestOpen(false)}
        onDropFiles={async (files) => {
          await onFiles(files);
        }}
        onPaste={async (text, kind) => {
          if (onIngestPaste) await onIngestPaste(text, kind);
        }}
        onImportUrl={async (url, onProgress) => {
          if (!onIngestUrl) throw new Error("Web ingest is unavailable.");
          await onIngestUrl(url, onProgress);
        }}
        onExtract={async (id) => {
          await onExtractEvidence?.(id);
        }}
        onAcceptRoster={async () => {
          await onAcceptExtract?.();
          setIngestOpen(false);
        }}
      />

      {previewId && (
        <div
          className="fixed inset-0 z-[70] flex items-stretch justify-end bg-slate-900/40 p-3 sm:p-6"
          onClick={() => setPreviewId(null)}
        >
          <div
            className="flex h-full min-h-0 w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SourceDocumentViewer
              evidence={evidence.find((row) => row.id === previewId) ?? null}
              citation={null}
              onClose={() => setPreviewId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
