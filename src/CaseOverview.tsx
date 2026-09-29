import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowRight, Check, Clock, Copy, Download, Eye, FileAudio, FileDown, FileText, GitCommitHorizontal, Globe, Image as ImageIcon, Inbox,
  Loader2, MapPin, MoreHorizontal, Pencil, Phone, Plus, RefreshCw, Trash2, Truck, Upload, Users,
} from "lucide-react";
import {
  CONTACT_AFFILIATIONS, createCaseContact, db, deleteCaseContact, deleteEvidence, formatBytes, promoteEntityToVerified, updateCase,
  updateCaseContact, addExternalIntelLead, patchIntelClaim, promoteIntelClaimToVerify,
  type CaseContactRecord, type CaseRecord, type CaseStatus,
  type EntityRecord, type EvidenceRecord, type TimelineEventRecord, type VerifyDraftRecord,
} from "./db";
import ArchiveCaseModal from "./ArchiveCaseModal";
import IntelTriageCard, { INTEL_SOURCE_LABELS } from "./IntelTriageCard";
import IngestDrawer from "./IngestDrawer";
import Sha256Badge from "./Sha256Badge";
import SourceDocumentViewer from "./SourceDocumentViewer";
import { calculateSHA256 } from "./lib/cryptoUtils";
import { parseExternalIntel } from "./lib/intelClient";
import type { ExternalIntelLead, IntelClaim, IntelSourceType } from "./types";
import { EVIDENCE_ACCEPT } from "./lib/pdfText";
import { ingestElapsedSec, type IngestJob } from "./lib/ingestProgress";
import { getCategoryColor } from "./utils/categoryColors";
import { formatRoleLabel, roleDisplayClass } from "./utils/roleBadge";
import { isSecondaryEvidence, isUncorroboratedEntity, sourceClassLabel } from "./lib/sourceTier";
import MediaProvenanceBadge from "./MediaProvenanceBadge";

const mono = "font-mono";

const STATUS_OPTIONS: { value: CaseStatus; label: string }[] = [
  { value: "ACTIVE", label: "Active Investigation" },
  { value: "REVIEW", label: "Grand Jury" },
  { value: "FIELD", label: "Field" },
  { value: "COLD", label: "Cold" },
];

const STATUS_TONE: Record<CaseStatus, string> = {
  ACTIVE: "border-blue-200 bg-blue-50 text-blue-700",
  REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  FIELD: "border-emerald-200 bg-emerald-50 text-emerald-800",
  COLD: "border-slate-200 bg-slate-100 text-slate-600",
  ARCHIVED: "border-slate-200 bg-slate-100 text-slate-600",
  CLOSED: "border-slate-200 bg-slate-100 text-slate-600",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function alibiLabel(entity: EntityRecord) {
  const notes = entity.notes.toLowerCase();
  if (notes.includes("alibi") && (notes.includes("conflict") || notes.includes("review"))) return "Alibi disputed";
  if (notes.includes("alibi")) return "Alibi on file";
  if (formatRoleLabel(entity.role) === "Suspect") return "Unconfirmed";
  return "";
}

function formatRange(events: TimelineEventRecord[]) {
  if (!events.length) return "No dated events yet";
  const min = Math.min(...events.map((e) => e.timestamp));
  const max = Math.max(...events.map((e) => e.timestamp));
  const fmt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const a = fmt(min);
  const b = fmt(max);
  return a === b ? a : `${a} — ${b}`;
}

function formatIncidentWindow(activeCase: CaseRecord, events: TimelineEventRecord[]) {
  const start = activeCase.incidentStart?.trim();
  const end = activeCase.incidentEnd?.trim();
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  if (start && end && start !== end) return `${fmt(start)} — ${fmt(end)}`;
  if (start) return fmt(start);
  return formatRange(events);
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
  conflictCount,
  onOpenTimeline,
  onInspectContradiction,
  onOpenEntity,
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
}: {
  activeCase: CaseRecord | null;
  entities: EntityRecord[];
  evidence: EvidenceRecord[];
  events: TimelineEventRecord[];
  pendingCount: number;
  conflictCount: number;
  onOpenTimeline: () => void;
  onInspectContradiction?: () => void;
  onOpenEntity: (entity: EntityRecord) => void;
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
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [addedNotice, setAddedNotice] = useState<{ count: number; names: string[] } | null>(null);
  const [notes, setNotes] = useState(activeCase?.workingNotes ?? "");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setNotes(activeCase?.workingNotes ?? "");
  }, [activeCase?.id]);

  useEffect(() => {
    if (!activeCase) return;
    const handle = window.setTimeout(() => {
      if (notes === (activeCase.workingNotes ?? "")) return;
      void updateCase(activeCase.id, { workingNotes: notes }).then(() => {
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1200);
      });
    }, 450);
    return () => window.clearTimeout(handle);
  }, [notes, activeCase?.id]);

  const persons = useMemo(() => entities.filter((e) => e.type === "person"), [entities]);
  const poi = useMemo(() => {
    const hot = persons.filter((e) => {
      const role = e.role.toLowerCase().replace(/[\s-]+/g, "_");
      return /subject|suspect|poi|person_of_interest|victim/.test(role);
    });
    return (hot.length ? hot : persons).slice(0, 6);
  }, [persons]);
  const verified = events.filter((e) => e.isVerified).sort((a, b) => b.timestamp - a.timestamp);
  const snapshot = [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
  const discrepancies = pendingCount + conflictCount + events.filter((e) => !e.isVerified).length;

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
  const [intelOpen, setIntelOpen] = useState(false);
  const [intelExpanded, setIntelExpanded] = useState<string | null>(null);
  const [intelBusy, setIntelBusy] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [intelForm, setIntelForm] = useState({
    title: "",
    sourceType: "forum_tip" as IntelSourceType,
    sourceUrl: "",
    rawContent: "",
  });

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

  const officialSources = evidence.filter((e) => !isSecondaryEvidence(e));
  const newsSources = evidence.filter((e) => isSecondaryEvidence(e));
  const registryRows = registryTab === "official" ? officialSources : newsSources;

  useEffect(() => {
    if (!sourceMenuId) return;
    const close = () => setSourceMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [sourceMenuId]);

  const intelLeads = useLiveQuery(
    async () => {
      if (!activeCase) return [] as ExternalIntelLead[];
      try {
        const rows = await db.externalIntel.where("caseId").equals(activeCase.id).toArray();
        return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } catch {
        return [] as ExternalIntelLead[];
      }
    },
    [activeCase?.id],
  ) ?? [];

  const visibleContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      `${c.name} ${c.affiliation} ${c.phone} ${c.email} ${c.address} ${c.notes}`.toLowerCase().includes(q),
    );
  }, [contacts, contactQuery]);

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
    const files = [...list];
    setIngestBusy(true);
    setDragging(false);
    dragDepth.current = 0;
    try {
      await onDropFiles(files);
      setAddedNotice({ count: files.length, names: files.map((f) => f.name) });
    } finally {
      setIngestBusy(false);
    }
  };

  const stageIntel = async () => {
    if (!activeCase || intelBusy) return;
    const title = intelForm.title.trim() || "Untitled lead";
    const rawContent = intelForm.rawContent.trim();
    if (rawContent.length < 12) {
      setIntelError("Paste a tip transcript or raw intel (at least a sentence).");
      return;
    }
    setIntelBusy(true);
    setIntelError(null);
    try {
      const sha256Hash = await calculateSHA256(new TextEncoder().encode(rawContent).buffer as ArrayBuffer);
      let parsed: Awaited<ReturnType<typeof parseExternalIntel>> = [];
      let parseFailed: string | null = null;
      try {
        parsed = await parseExternalIntel(rawContent);
      } catch (err) {
        parseFailed = err instanceof Error ? err.message : "Could not parse that lead.";
      }
      const id = crypto.randomUUID();
      const claims: IntelClaim[] = parsed.map((row) => ({
        id: crypto.randomUUID(),
        leadId: id,
        category: row.category,
        claimText: row.claimText,
        extractedTimestamp: row.extractedTimestamp,
        verbatimQuote: row.verbatimQuote,
        confidence: row.confidence,
        triageStatus: "pending",
        promotedToVerifyQueue: false,
      }));
      const lead: ExternalIntelLead = {
        id,
        caseId: activeCase.id,
        title,
        sourceUrl: intelForm.sourceUrl.trim() || undefined,
        sourceType: intelForm.sourceType,
        rawContent,
        sha256Hash,
        createdAt: new Date().toISOString(),
        status: claims.length ? "triaged" : "unparsed",
        claims,
      };
      await addExternalIntelLead(lead);
      setIntelForm({ title: "", sourceType: "forum_tip", sourceUrl: "", rawContent: "" });
      setIntelExpanded(id);
      if (parseFailed) {
        setIntelError(`${parseFailed} The raw lead was still staged.`);
      } else {
        setIntelOpen(false);
        setIntelError(null);
      }
    } catch (err) {
      setIntelError(err instanceof Error ? err.message : "Could not parse that lead.");
    } finally {
      setIntelBusy(false);
    }
  };

  if (!activeCase) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center px-10 pb-20 pt-24 text-center">
        <h1 className="mb-3 text-[34px] font-semibold tracking-tight">No case selected</h1>
        <p className="max-w-[42ch] text-[14px] text-slate-500">Open a case from Hub or finish setup to land on the overview dashboard.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-10 pb-20 pt-10">
      <input
        ref={fileRef}
        type="file"
        accept={EVIDENCE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }}
      />

      <div className="mb-7 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>
            {activeCase.id} / CASE OVERVIEW
          </div>
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight">{activeCase.title}</h1>
          {activeCase.isArchived && (
            <span className={`mt-2 inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-slate-500`}>ARCHIVED</span>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[13px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatIncidentWindow(activeCase, events)}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{activeCase.jurisdiction?.trim() || "Jurisdiction unassigned"}</span>
            {activeCase.isArchived ? (
              <span className={`ml-1 rounded-lg border px-2.5 py-1 ${mono} text-[10.5px] tracking-[0.06em] ${STATUS_TONE.ARCHIVED}`}>ARCHIVED</span>
            ) : (
              <select
                value={STATUS_OPTIONS.some((o) => o.value === activeCase.status) ? activeCase.status : "ACTIVE"}
                onChange={(e) => void updateCase(activeCase.id, { status: e.target.value as CaseStatus })}
                className={`ml-1 rounded-lg border px-2.5 py-1 ${mono} text-[10.5px] tracking-[0.06em] outline-none ${STATUS_TONE[activeCase.status] ?? STATUS_TONE.ACTIVE}`}
                aria-label="Case status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            {ingestJob && ingestJob.stage !== "done" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] font-medium text-amber-900">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                Analyzing evidence: {evidence.find((e) => e.id === ingestJob.evidenceId)?.fileName || "source"} ({ingestElapsedSec(ingestJob, nowMs ?? Date.now())}s elapsed)
              </span>
            )}
            {(!ingestJob || ingestJob.stage === "done") && extractNotice && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-800">
                <Check className="h-3 w-3" />
                Indexed {extractNotice.entityCount} {extractNotice.entityCount === 1 ? "entity" : "entities"} from {extractNotice.fileName}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {onExportDossier && (
            <button type="button" disabled={!canExport} onClick={onExportDossier}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 text-sm font-medium tracking-wide text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40">
              <FileDown className="h-3.5 w-3.5 text-slate-500" />Export Official INTELLIDEX
            </button>
          )}
          {activeCase.isArchived ? (
            <button type="button" onClick={onUnarchiveCase}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
              <ArchiveRestore className="h-3.5 w-3.5" />Unarchive Case
            </button>
          ) : null}
          <button type="button" onClick={() => setIngestOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700">
            <Upload className="h-3.5 w-3.5" />Add Evidence
          </button>
          <button type="button" onClick={onOpenTimeline}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-blue-600 hover:text-blue-700">
            View Full Timeline<ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Sources ingested", value: evidence.length, icon: FileText, onClick: () => setIngestOpen(true) },
          { label: "Verified events", value: verified.length, icon: GitCommitHorizontal, onClick: onOpenTimeline },
          { label: "Unresolved gaps", value: discrepancies, icon: AlertTriangle, onClick: conflictCount ? onInspectContradiction : undefined },
          { label: "Persons of interest", value: poi.length, icon: Users, onClick: undefined },
        ].map((stat) => (
          <button
            key={stat.label}
            type="button"
            disabled={!stat.onClick}
            onClick={() => stat.onClick?.()}
            className={`rounded-[14px] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm disabled:opacity-100 ${stat.onClick ? "cursor-pointer transition-colors hover:border-amber-300" : "cursor-default"}`}
          >
            <div className="mb-3 flex items-center justify-between text-slate-400">
              <stat.icon className="h-4 w-4" />
              <span className={`${mono} text-[10px] tracking-[0.12em] text-slate-500`}>{stat.label.toUpperCase()}</span>
            </div>
            <div className="text-[28px] font-semibold tracking-tight">{stat.value}</div>
          </button>
        ))}
      </div>

      <div className="mb-8">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>INGESTED EVIDENCE & SOURCES</h2>
          <span className={`${mono} text-[11px] text-slate-400`}>{evidence.length} FILES INDEXED</span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-[10px] border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setRegistryTab("official")}
            className={`rounded-[8px] px-2 py-2 text-[12px] font-semibold ${registryTab === "official" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            Official Records ({officialSources.length} files)
          </button>
          <button
            type="button"
            onClick={() => setRegistryTab("news")}
            className={`rounded-[8px] px-2 py-2 text-[12px] font-semibold ${registryTab === "news" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
          >
            News & Research Archive ({newsSources.length} articles)
          </button>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
              if (!dragging) setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dragDepth.current = 0;
              setDragging(false);
              void onFiles(e.dataTransfer.files);
            }}
            className={`mb-4 flex flex-col items-stretch gap-3 rounded-[10px] border-2 border-dashed px-3 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
              ingestBusy
                ? "border-blue-400 bg-blue-50/70"
                : dragging
                  ? "border-blue-600 bg-blue-50"
                  : "border-slate-300 bg-slate-50/60"
            }`}
          >
            <div className="min-w-0 text-[12.5px] text-slate-600">
              {ingestBusy ? "Saving to local vault…" : dragging ? "Release to ingest onto this case." : "Drop files here or ingest a new source."}
            </div>
            <button
              type="button"
              disabled={ingestBusy}
              onClick={() => { if (!ingestBusy) fileRef.current?.click(); }}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-blue-600 px-3 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {ingestBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Ingest New Source
            </button>
          </div>

          {registryRows.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-[13px] text-slate-500">
              {registryTab === "official"
                ? "No official records ingested yet. Upload affidavits, police reports, or transcripts."
                : "No news or research articles yet. Import a web link from External Intelligence & Press."}
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
                            <span className={`rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-amber-900`}>
                              SECONDARY
                            </span>
                          ) : (
                            <span className={`rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-slate-600`}>
                              PRIMARY
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-500">
                          <span>{stamp}</span>
                          {size ? <span>· {size}</span> : null}
                          <span className={`rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.04em] ${badge.cls}`}>{badge.text}</span>
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
                        onClick={() => onInspectSource?.(ev.id)}
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
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>PRIMARY SUSPECT & KEY ENTITIES</h2>
          <span className={`${mono} text-[11px] text-slate-400`}>{persons.length} PEOPLE ON CASE</span>
        </div>
        {poi.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-[13px] text-slate-500">
            No people on this case yet. Ingest a source to extract entities.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {poi.map((ent) => {
              const cat = { entityType: ent.type, role: ent.role, name: ent.name, text: ent.notes };
              return (
              <button key={ent.id} type="button" onClick={() => onOpenEntity(ent)}
                className="rounded-[14px] border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300">
                <div className="flex gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold ${getCategoryColor(cat, "badge")}`}>
                    {initials(ent.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight">{ent.name}</span>
                      <span className={`shrink-0 rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] whitespace-nowrap ${roleDisplayClass(ent.role, getCategoryColor(cat, "badge"))}`}>
                        {formatRoleLabel(ent.role)}
                      </span>
                      <MediaProvenanceBadge
                        show={isUncorroboratedEntity(ent)}
                        onPromote={() => void promoteEntityToVerified(ent.id)}
                      />
                    </div>
                    {alibiLabel(ent) ? (
                      <div className="mb-1 text-[12px] text-slate-500">{alibiLabel(ent)}</div>
                    ) : null}
                    <p className="line-clamp-2 text-[12.5px] leading-relaxed text-slate-500">{ent.notes || "No case notes yet."}</p>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-8">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>CASE CONTACTS & ROLODEX</h2>
          <div className="flex items-center gap-2">
            <input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Search contacts"
              className="h-8 w-[180px] rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setContactForm({ name: "", affiliation: "Victim Family / Next of Kin", entityId: "", phone: "", email: "", address: "", notes: "" })}
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
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.type}</option>)}
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
            No contacts yet. Add next of kin, counsel, or a site key-holder.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visibleContacts.map((c) => {
              const linked = entities.find((e) => e.id === c.entityId);
              return (
                <div key={c.id} className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[14.5px] font-semibold">{c.name}</div>
                      <div className={`${mono} text-[10.5px] tracking-[0.04em] text-slate-500`}>{c.affiliation}</div>
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
        )}
      </div>

      <div className="mb-8 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section>
          <div className="mb-3.5 flex items-baseline justify-between">
            <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>TIMELINE SNAPSHOT</h2>
            <button type="button" onClick={onOpenTimeline} className={`${mono} text-[11px] text-blue-600 hover:underline`}>OPEN CHRONOLOGY</button>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={onOpenTimeline}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenTimeline(); } }}
            className="w-full cursor-pointer rounded-[14px] border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-300"
          >
            {snapshot.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-slate-500">No timeline events yet. Confirm facts in Verify.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {snapshot.map((ev, i) => {
                  const ent = entities.find((e) => e.id === ev.entityId);
                  const src = evidence.find((row) => row.id === ev.sourceDocId);
                  const secondary = ev.tier === "secondary" || Boolean(src && isSecondaryEvidence(src));
                  const citeUrl = ev.sourceCitation?.sourceUrl || src?.sourceUrl;
                  const cat = { entityType: ent?.type, role: ent?.role, name: ent?.name, text: `${ev.title} ${ev.description}` };
                  return (
                  <div key={ev.id} className={`flex gap-3 rounded-[10px] px-1 py-1 ${secondary ? "border border-dashed border-amber-400 bg-amber-50/40" : ""}`}>
                    <div className="flex w-4 flex-col items-center">
                      <span className={`mt-1.5 h-2 w-2 rounded-full ${getCategoryColor(cat, "dot")}`} />
                      {i < snapshot.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className={`${mono} text-[10.5px] text-slate-500`}>{formatStamp(ev.timestamp)}</div>
                      <div className="truncate text-[13.5px] font-medium">{ev.title}</div>
                      <div className="truncate text-[12px] text-slate-500">{ev.description}</div>
                      {citeUrl ? (
                        <a
                          href={citeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 inline-block text-[11.5px] font-semibold text-amber-800 underline"
                        >
                          Source article
                        </a>
                      ) : null}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3.5 flex items-baseline justify-between">
            <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>WORKING THEORY</h2>
            <span className={`${mono} text-[11px] ${savedFlash ? "text-emerald-600" : "text-slate-400"}`}>
              {savedFlash ? "SAVED" : "AUTOSAVE · INDEXEDDB"}
            </span>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Initial impressions, open leads, hypotheses…"
            className="min-h-[220px] w-full resize-y rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-[13.5px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12"
          />
        </section>
      </div>

      <div>
        <h2 className={`mb-3.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>SOURCE INGESTION</h2>
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDepth.current = 0;
            setDragging(false);
            void onFiles(e.dataTransfer.files);
          }}
          onClick={() => { if (!ingestBusy) fileRef.current?.click(); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-[14px] border-2 border-dashed px-6 py-10 text-center transition-colors ${
            ingestBusy
              ? "border-blue-400 bg-blue-50/70"
              : dragging
                ? "border-blue-600 bg-blue-50"
                : "border-slate-300 bg-white hover:border-slate-400"
          }`}
        >
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
            {ingestBusy ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : dragging ? <Inbox className="h-4 w-4 text-blue-600" /> : <Upload className="h-4 w-4" />}
          </div>
          <div className="text-[14.5px] font-semibold">
            {ingestBusy ? "Saving to local vault…" : dragging ? "Release to attach to this case" : "Drop reports onto this case"}
          </div>
          <p className="mt-1 max-w-[42ch] text-[12.5px] text-slate-500">
            PDF, text, markdown, and images attach to the local vault without leaving overview.
          </p>
        </div>

        {addedNotice && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
            <span>
              {addedNotice.count} source file{addedNotice.count === 1 ? "" : "s"} added to vault.
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIngestOpen(true); }}
              className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline"
            >
              Go to Intake <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {entities.some((e) => e.type !== "person") && (
          <div className="mt-4 flex flex-wrap gap-2">
            {entities.filter((e) => e.type !== "person").slice(0, 8).map((e) => (
              <button key={e.id} type="button" onClick={() => onOpenEntity(e)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-600 hover:border-blue-300">
                {e.type === "vehicle" ? <Truck className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                {e.name}
                {isUncorroboratedEntity(e) ? (
                  <span className="rounded border border-amber-300 bg-amber-50 px-1 text-[9.5px] font-semibold text-amber-900">Media</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="mt-10 rounded-xl border border-slate-200 bg-slate-50/60 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={`mb-1 ${mono} text-[11px] font-medium tracking-[0.14em] text-slate-500`}>EXTERNAL INTELLIGENCE & OPEN LEADS</div>
            <div className="flex flex-wrap gap-2 text-[12px] text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5">
                {intelLeads.filter((l) => l.status !== "archived").length} Open Leads
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5">
                {intelLeads.reduce((n, l) => n + l.claims.filter((c) => c.triageStatus === "promoted" || c.triageStatus === "pending").length, 0)} Triaged Claims
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setIntelOpen(true); setIntelError(null); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-[13px] font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />Ingest Outside Intel
          </button>
        </div>

        {intelLeads.length === 0 ? (
          <p className="text-[13px] text-slate-500">No outside tips staged yet. Ingest a forum post, scanner log, or witness lead to parse claims for Verify.</p>
        ) : (
          <div className="grid gap-2.5">
            {intelLeads.map((lead) => (
              <IntelTriageCard
                key={lead.id}
                lead={lead}
                events={events}
                expanded={intelExpanded === lead.id}
                onToggle={() => setIntelExpanded((id) => (id === lead.id ? null : lead.id))}
                onPromote={(claim) => promoteIntelClaimToVerify(lead, claim)}
                onDismiss={(claim) => patchIntelClaim(lead.id, claim.id, { triageStatus: "dismissed" })}
              />
            ))}
          </div>
        )}
      </section>

      {!activeCase.isArchived && (
        <section className="mt-12">
          <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 max-w-2xl">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">Archive case</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                Move this investigation to the Archived tab on the Hub. You can restore it anytime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"
            >
              <Archive className="h-3.5 w-3.5 text-slate-500" />
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

      {intelOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-[16px] border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="mb-1 text-[17px] font-bold tracking-tight">Ingest outside intel</h2>
            <p className="mb-4 text-[12.5px] text-slate-500">Stage an unvetted lead, hash the transcript, and parse discrete claims with AI.</p>
            <label className="mb-1 block text-[12px] font-semibold text-slate-700">Lead Title</label>
            <input
              value={intelForm.title}
              onChange={(e) => setIntelForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Anonymous forum post — white Elantra"
              className="mb-3 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-400"
            />
            <label className="mb-1 block text-[12px] font-semibold text-slate-700">Source Type</label>
            <select
              value={intelForm.sourceType}
              onChange={(e) => setIntelForm((f) => ({ ...f, sourceType: e.target.value as IntelSourceType }))}
              className="mb-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none"
            >
              {(Object.keys(INTEL_SOURCE_LABELS) as IntelSourceType[]).map((key) => (
                <option key={key} value={key}>{INTEL_SOURCE_LABELS[key]}</option>
              ))}
            </select>
            <label className="mb-1 block text-[12px] font-semibold text-slate-700">Source URL <span className="font-normal text-slate-400">(optional)</span></label>
            <input
              value={intelForm.sourceUrl}
              onChange={(e) => setIntelForm((f) => ({ ...f, sourceUrl: e.target.value }))}
              placeholder="https://"
              className="mb-3 h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-400"
            />
            <label className="mb-1 block text-[12px] font-semibold text-slate-700">Raw Intel / Tip Transcript</label>
            <textarea
              value={intelForm.rawContent}
              onChange={(e) => setIntelForm((f) => ({ ...f, rawContent: e.target.value }))}
              rows={7}
              placeholder="Paste the unvetted tip, scanner log, or witness write-up…"
              className="mb-3 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-blue-400"
            />
            {intelError && (
              <div className="mb-3 text-[12.5px] text-amber-800">{intelError}</div>
            )}
            <div className="flex justify-end gap-2.5">
              <button type="button" onClick={() => setIntelOpen(false)} className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                type="button"
                disabled={intelBusy}
                onClick={() => void stageIntel()}
                className="inline-flex h-10 items-center rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {intelBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Stage & Parse with AI
              </button>
            </div>
          </div>
        </div>
      )}

      <IngestDrawer
        open={ingestOpen}
        busy={ingestBusy}
        error={extractError}
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
