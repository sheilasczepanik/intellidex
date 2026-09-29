import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addEvidence, addVerifyDrafts, applyThemePreference, computeAvatarInitials, confirmVerifyDraft, createCase, createEntity, createTimelineEvent,
  db, DEFAULT_OPERATOR, deleteEntity, deleteEvidence, deleteTimelineEvent, formatBytes, formatTouched, hydrateUserProfile, isArchivedCase, listHubCases, parseEventTime, rejectVerifyDraft,
  OPERATOR_ID, resetLocalVault, saveOperatorProfile, setCaseArchived, statusToTone, updateCase, updateEntity, updateTimelineEvent, updateVerifyDraft, type CaseStatus, type EntityRecord, type EntityType,
  type EvidenceRecord, type TimelineEventRecord, type VerifyDraftRecord, type EntityRelationship,
} from "./db";
import { extractEventsFromText, extractEventsFromImage, extractEventsFromRenderedPages, scoutEntitiesFromText } from "./lib/extractClient";
import { renderPdfPagesToJpeg } from "./lib/pdfHelpers";
import { calculateSHA256, calculateSHA256FromText } from "./lib/cryptoUtils";
import { scrapeArticleFromUrl } from "./lib/scrapeClient";
import { generateAndDownloadDossier, type DossierExportOptions } from "./lib/DossierPdfGenerator";
import EntityGraph from "./EntityGraph";
import { applyExtractedGraph } from "./lib/applyExtractGraph";
import CaseOverview from "./CaseOverview";
import ArchiveCaseModal from "./ArchiveCaseModal";
import EvidenceIntake, {
  STAGE_SIZE_ERROR,
  STAGE_TIMEOUT_ERROR,
  STAGE_TIMEOUT_MS,
  clearIngestingAsFailed,
  stageEvidenceFile,
  stagingFailureMessage,
  withStageTimeout,
} from "./EvidenceIntake";
import EditEntityDrawer from "./EditEntityDrawer";
import EntityDossier from "./EntityDossier";
import EvidenceThumb from "./EvidenceThumb";
import ExportDossierModal from "./ExportDossierModal";
import GlobalSearch from "./GlobalSearch";
import ProfileSettings from "./ProfileSettings";
import SourceDocumentViewer, { CitationPill } from "./SourceDocumentViewer";
import TimelineToolbar from "./Timeline";
import VerifyQueueCard, { citationFromDraft, citationFromEvent } from "./VerifyQueueCard";
import WorkspacePreferences from "./WorkspacePreferences";
import { ExtractSelectionTip, VERIFY_CATEGORIES } from "./Verify";
import {
  ingestElapsedSec, ingestStageLabel, type IngestJob,
} from "./lib/ingestProgress";
import { LOW_CLARITY_BADGE, UNREADABLE_SCAN_ALERT, assessTextClarity, isUnreadableScan, logExtractedText } from "./lib/textClarity";
import { EVIDENCE_ACCEPT, isPdfFile, isTextFile } from "./lib/pdfText";
import { evidenceImageSrc, isImageFile } from "./lib/imageEvidence";
import type { ScoutedEntity } from "./lib/extractSchema";
import { inferSourceType, type SourceCitation } from "./types";
import { CLAUDE_MAX_CHARS, CLAUDE_MAX_PAGES, CLAUDE_RETRY_PAGES, windowSourceText } from "./lib/extractSchema";
import { collectQuoteSpans, narrativeSortKey, sortByNarrativeOrder, splitTextBySpans } from "./lib/quoteAnchors";
import { getLocalApiKey, getLocalProvider, setLocalApiKey, setLocalProvider, type LlmProvider } from "./lib/settings";
import { joinLocalDateTime, localDayKey, namesLooselyMatch, splitLocalDateTime } from "./lib/eventTime";
import {
  HOUR_MS, LANE_PAD, UNASSIGNED_LANE_ID, busiestDayKey, eventInHourWindow, fitPxPerHour,
  formatClockRange, formatDayHeading, paddedBounds, pxForPreset, tickMsFor, uniqueDayKeys,
  windowHours, type TickPreset, type TimeWindow,
} from "./lib/timelineView";
import { getCategoryColor, resolveSemanticCategory } from "./utils/categoryColors";
import { formatRoleLabel, normalizePersonRole, PERSON_ROLE_VALUES, roleDisplayClass } from "./utils/roleBadge";
import type { SearchHit } from "./lib/globalSearch";
import {
  ArrowRight, Archive, ArchiveRestore, Check, CheckCheck, Clock, CloudUpload, FileDown,
  FileText, FolderPlus, GitCommitHorizontal, GitFork, Inbox, KeyRound, LayoutDashboard, Loader2,
  Link2, ListChecks, LayoutGrid, Lock, MapPin, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Phone, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Trash2, Truck,
  TriangleAlert, Upload, User, Users, UserRound, X, Box,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type Screen = "Hub" | "Setup" | "Overview" | "Intake" | "Verify" | "Timeline" | "Graph" | "Profile" | "Preferences";
export type Tone = "active" | "review" | "cold" | "ok" | "fail";
export type EntityKind = "People" | "Places" | "Vehicles" | "Phones" | "Digital" | "Exhibits";

function screenFromPath(pathname: string): Screen | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/hub") return "Hub";
  if (path === "/setup") return "Setup";
  if (path === "/overview") return "Overview";
  if (path === "/intake") return "Intake";
  if (path === "/verify") return "Verify";
  if (path === "/timeline") return "Timeline";
  if (path === "/graph") return "Graph";
  if (path.startsWith("/settings/profile")) return "Profile";
  if (path.startsWith("/settings/workspace")) return "Preferences";
  return null;
}

function pathFromScreen(screen: Screen) {
  if (screen === "Hub") return "/hub";
  if (screen === "Profile") return "/settings/profile";
  if (screen === "Preferences") return "/settings/workspace";
  return `/${screen.toLowerCase()}`;
}

const CASE_WORKSPACE: Screen[] = ["Setup", "Overview", "Intake", "Verify", "Timeline", "Graph"];

function NoActiveCase({ onHub }: { onHub: () => void }) {
  return (
    <div className="flex min-h-[calc(100vh-94px)] flex-1 flex-col items-center justify-center px-8 py-24 text-center">
      <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">No Active Case Selected</h2>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-slate-500">
        Timeline and Relationship Graph data are scoped to individual cases.
      </p>
      <button
        type="button"
        onClick={onHub}
        className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-blue-600 px-4 text-[13.5px] font-semibold text-white hover:bg-blue-700"
      >
        Return to Hub
      </button>
    </div>
  );
}

export interface CaseSummary {
  id: string;
  title: string;
  status: string;
  tone: Tone;
  summary: string;
  entities: string;
  files: string;
  touched: string;
  pct: number;
}

export interface Entity {
  icon: EntityKind;
  name: string;
  chip: string;
  v: Record<string, string>;
}

export type EntityStore = Record<EntityKind, Entity[]>;

export interface FieldDef {
  k: string;
  label: string;
  ph: string;
  half?: boolean;
  area?: boolean;
}

export interface KindSchema {
  noun: string;
  statuses: string[];
  fields: FieldDef[];
}

export interface QueueFile {
  icon: "pdf" | "csv" | "image" | "audio" | "mail";
  name: string;
  sub: string;
  size: string;
  pct: number;
  status: string;
  tone: Tone;
}

export interface DraftCard {
  id: string;
  span: string;
  time: string;
  m: number;
  lane: LaneId;
  tag: string;
  title: string;
  entity: string;
  conf: number;
  sub: string;
  snippet: string;
  source: string;
}

export type LaneId = "vance" | "webb" | "toll";

export interface TimelineEvent {
  id: string;
  lane: LaneId;
  m: number;
  time: string;
  tag: string;
  title: string;
  sub: string;
  flag?: boolean;
  fresh?: boolean;
}

export interface WizardFormState {
  tab: EntityKind;
  id: string | null;
  name: string;
  chip: string;
  v: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* mock data                                                           */
/* ------------------------------------------------------------------ */

const CASE_STATUSES: CaseStatus[] = ["ACTIVE", "REVIEW", "COLD", "FIELD"];

const STEPS = [
  { label: "Case details", hint: "Title, jurisdiction, dates" },
  { label: "Sources", hint: "Upload or paste reports" },
  { label: "Entities", hint: "Derived from sources" },
  { label: "Review", hint: "Confirm and open case" },
];
const SETUP_CRUMB = ["DETAILS", "SOURCES", "ENTITIES", "REVIEW"];

const SCHEMA: Record<EntityKind, KindSchema> = {
  People: {
    noun: "person",
    statuses: [...PERSON_ROLE_VALUES],
    fields: [
      { k: "role", label: "Role in case", ph: "Director, Meridian Freight" },
      { k: "dob", label: "Date of birth", ph: "DOB 1974-03-11", half: true },
      { k: "contact", label: "Last known contact", ph: "Phone, address or none", half: true },
      { k: "note", label: "Notes", ph: "What makes this person relevant", area: true },
    ],
  },
  Places: {
    noun: "place",
    statuses: ["PRIMARY", "REGISTERED", "UNVERIFIED"],
    fields: [
      { k: "address", label: "Address", ph: "Dock road, east quay" },
      { k: "coords", label: "Coordinates", ph: "51.9244° N, 4.4777° E", half: true },
      { k: "refs", label: "Referenced in", ph: "38 documents", half: true },
      { k: "note", label: "Notes", ph: "Access, hours, who controls it", area: true },
    ],
  },
  Vehicles: {
    noun: "vehicle",
    statuses: ["TRACKED", "REGISTERED", "UNVERIFIED"],
    fields: [
      { k: "plate", label: "Plate", ph: "4211-XK", half: true },
      { k: "owner", label: "Registered to", ph: "Meridian Freight", half: true },
      { k: "sightings", label: "Sightings", ph: "19 ANPR hits" },
      { k: "note", label: "Notes", ph: "Distinguishing marks, condition", area: true },
    ],
  },
  Phones: {
    noun: "phone",
    statuses: ["TRACKED", "REGISTERED", "UNVERIFIED"],
    fields: [
      { k: "contact", label: "Number", ph: "+1 208-555-0199", half: true },
      { k: "owner", label: "Subscriber", ph: "Named subscriber", half: true },
      { k: "note", label: "Notes", ph: "Handset, IMEI, recovery", area: true },
    ],
  },
  Digital: {
    noun: "digital",
    statuses: ["TRACKED", "PRIMARY", "UNVERIFIED"],
    fields: [
      { k: "refs", label: "Identifier", ph: "Tower, IMEI, camera ID" },
      { k: "note", label: "Notes", ph: "Pings, coverage, timezone", area: true },
    ],
  },
  Exhibits: {
    noun: "exhibit",
    statuses: ["PRIMARY", "UNVERIFIED"],
    fields: [
      { k: "refs", label: "Tag / bag", ph: "Item 4 — sheath" },
      { k: "note", label: "Notes", ph: "Custody, lab, photos", area: true },
    ],
  },
};

const TONE_FOR: Record<string, Tone> = {
  SUSPECT: "active", SUBJECT: "active", person_of_interest: "active", poi: "active", PRIMARY: "active", TRACKED: "active",
  WITNESS: "ok", REGISTERED: "ok", ASSOCIATE: "cold", UNVERIFIED: "review", VICTIM: "fail",
};

const KIND_TYPE: Record<EntityKind, EntityType> = {
  People: "person", Places: "place", Vehicles: "vehicle", Phones: "phone", Digital: "digital", Exhibits: "exhibit",
};

const TYPE_KIND: Record<EntityType, EntityKind> = {
  person: "People",
  place: "Places",
  location: "Places",
  vehicle: "Vehicles",
  phone: "Phones",
  digital: "Digital",
  exhibit: "Exhibits",
};

const SAMPLE_NARRATIVE = `Reporting officer responded to a dispatch call regarding suspicious activity at the Pier 9 bonded warehouse. On arrival the gate was unsecured and no personnel were present.

The complainant states that a grey sedan matching the subject vehicle was observed departing Kestrel Row at approximately 20:05, travelling north.

Motel records obtained from the Blue Heron Motel show a check-in at 19:30 hours to Room 214 under the name M. Webb, paid in cash.

A room service ticket timestamped 22:45 was logged against Room 214 and signed illegibly.

Network records show the handset registered to J. Vance ceased reporting to any tower at 23:30 and did not re-register until the following morning.`;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const CARD_W = 168, CARD_H = 44, CARD_GAP = 8, CARD_PAD = 12, RULER_H = 35;
const TRANSIT_CONFLICT_MS = 50 * 60 * 1000;

const TONE_CHIP: Record<Tone, string> = {
  active: "text-blue-700 bg-blue-50 border-blue-200",
  review: "text-amber-700 bg-amber-50 border-amber-200",
  cold: "text-slate-500 bg-slate-100 border-slate-200",
  ok: "text-emerald-700 bg-emerald-50 border-emerald-200",
  fail: "text-red-700 bg-red-50 border-red-200",
};
const TONE_BAR: Record<Tone, string> = {
  active: "bg-blue-600", review: "bg-amber-600", cold: "bg-slate-300", ok: "bg-emerald-600", fail: "bg-red-600",
};

const SCAN_NOTE = LOW_CLARITY_BADGE;

const mono = "font-mono";
const Chip = ({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) => (
  <span className={`inline-flex min-w-0 max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${TONE_CHIP[tone]} ${className}`}>
    {children}
  </span>
);

const ENTITY_ICON: Record<EntityKind, React.ComponentType<{ className?: string }>> = {
  People: User, Places: MapPin, Vehicles: Truck, Phones: Phone, Digital: Radio, Exhibits: Box,
};
const TAB_ICON: Record<EntityKind, React.ComponentType<{ className?: string }>> = {
  People: Users, Places: MapPin, Vehicles: Truck, Phones: Phone, Digital: Radio, Exhibits: Box,
};

const notesFromForm = (v: Record<string, string>) =>
  [v.note, v.role, v.dob, v.contact, v.address, v.coords, v.refs, v.plate, v.owner, v.sightings]
    .filter((s) => s?.trim())
    .join(" · ");

function toDatetimeLocal(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function evidenceMeta(q: EvidenceRecord) {
  const bits = [q.fileType.toUpperCase()];
  if (q.pageCount) bits.push(`${q.pageCount} page${q.pageCount === 1 ? "" : "s"}`);
  const size = formatBytes(q.fileSize);
  if (size) bits.push(size);
  return bits.join(" · ");
}

function formatClock(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type SuggestedIdentity = ScoutedEntity & { id: string };

function scoutRole(type: EntityType, raw: string) {
  const s = raw.toUpperCase();
  if (type === "person") {
    if (s.includes("PERSON OF INTEREST") || s.includes("POI")) return "person_of_interest";
    if (s.includes("SUSPECT") || s.includes("SUBJECT")) return "SUSPECT";
    if (s.includes("VICTIM")) return "VICTIM";
    if (s.includes("WITNESS")) return "WITNESS";
    if (s.includes("ASSOCIATE") || s.includes("OFFICER") || s.includes("LAW")) return "ASSOCIATE";
    return "UNVERIFIED";
  }
  if (type === "place") {
    if (s.includes("PRIMARY")) return "PRIMARY";
    if (s.includes("REGISTER")) return "REGISTERED";
    return "UNVERIFIED";
  }
  if (s.includes("TRACK")) return "TRACKED";
  if (s.includes("REGISTER")) return "REGISTERED";
  return "UNVERIFIED";
}

function formatRangeLabel(start: number, end: number, allDates: boolean) {
  const a = new Date(start);
  const b = new Date(end);
  const dayA = a.toLocaleDateString(undefined, { day: "2-digit", month: "short" }).toUpperCase();
  const dayB = b.toLocaleDateString(undefined, { day: "2-digit", month: "short" }).toUpperCase();
  const day = allDates && dayA !== dayB ? `${dayA}–${dayB}` : dayA;
  return `${day} · ${formatClockRange(start, end)}`;
}

const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

/* ------------------------------------------------------------------ */
/* app                                                                 */
/* ------------------------------------------------------------------ */

export default function DesktopApp() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname) ?? "Hub");
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<EntityKind>("People");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftStatus, setDraftStatus] = useState<CaseStatus>("ACTIVE");
  const [savingCase, setSavingCase] = useState(false);
  const [hubTab, setHubTab] = useState<"active" | "archived">("active");
  const [hubCardMenuId, setHubCardMenuId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [archivePrompt, setArchivePrompt] = useState<{ id: string; title: string } | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>("CASE-0038");

  const hubCases = useLiveQuery(listHubCases);
  const activeHubCases = (hubCases ?? []).filter((c) => !isArchivedCase(c));
  const archivedHubCases = (hubCases ?? []).filter((c) => isArchivedCase(c));
  const resolvedCaseId = activeCaseId === ""
    ? null
    : (hubCases?.some((c) => c.id === activeCaseId) ? activeCaseId : null)
      ?? activeHubCases.find((c) => c.id === "CASE-0038")?.id
      ?? activeHubCases[0]?.id
      ?? null;
  const activeCase = hubCases?.find((c) => c.id === resolvedCaseId) ?? null;

  const caseEntities = useLiveQuery(
    () => (resolvedCaseId ? db.entities.where("caseId").equals(resolvedCaseId).toArray() : Promise.resolve([] as EntityRecord[])),
    [resolvedCaseId],
  ) ?? [];
  const caseRelationships = useLiveQuery(
    () => (resolvedCaseId ? db.relationships.where("caseId").equals(resolvedCaseId).toArray() : Promise.resolve([] as EntityRelationship[])),
    [resolvedCaseId],
  ) ?? [];
  const caseEvents = useLiveQuery(
    () => (resolvedCaseId ? db.timelineEvents.where("caseId").equals(resolvedCaseId).sortBy("timestamp") : Promise.resolve([] as TimelineEventRecord[])),
    [resolvedCaseId],
  ) ?? [];
  const caseEvidence = useLiveQuery(
    () => (resolvedCaseId ? db.evidence.where("caseId").equals(resolvedCaseId).reverse().sortBy("id") : Promise.resolve([] as EvidenceRecord[])),
    [resolvedCaseId],
  ) ?? [];
  const pendingDrafts = useLiveQuery(
    () => (resolvedCaseId
      ? db.verifyDrafts.where("[caseId+status]").equals([resolvedCaseId, "pending"]).toArray()
        .catch(() => db.verifyDrafts.where("caseId").equals(resolvedCaseId).filter((d) => d.status === "pending").toArray())
      : Promise.resolve([] as VerifyDraftRecord[])),
    [resolvedCaseId],
  ) ?? [];

  const fileRef = useRef<HTMLInputElement>(null);
  const setupFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<WizardFormState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [activeHoveredCardId, setActiveHoveredCardId] = useState<string | null>(null);
  const [timelineInspect, setTimelineInspect] = useState<{ eventId: string; citation: SourceCitation } | null>(null);
  const hoverOriginRef = useRef<"card" | "doc" | null>(null);
  const sourcePaneRef = useRef<HTMLDivElement>(null);
  const queuePaneRef = useRef<HTMLDivElement>(null);
  const queueSyncLock = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [popover, setPopover] = useState(false);
  const [popoverAnchor, setPopoverAnchor] = useState<{ left: number; top: number } | null>(null);
  const [conflictPulse, setConflictPulse] = useState(0);
  const [pendingInspectId, setPendingInspectId] = useState<string | null>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const inspectLock = useRef(false);
  const [drawerEventId, setDrawerEventId] = useState<string | null>(null);
  const [drawerEdit, setDrawerEdit] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState("");
  const [drawerWhen, setDrawerWhen] = useState("");
  const [drawerDesc, setDrawerDesc] = useState("");
  const [drawerEntityId, setDrawerEntityId] = useState("");
  const [savingDrawer, setSavingDrawer] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventEntityId, setEventEntityId] = useState("");
  const [eventWhen, setEventWhen] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [savingEvent, setSavingEvent] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [ingestJob, setIngestJob] = useState<IngestJob | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [extractError, setExtractError] = useState<string | null>(null);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [extractTip, setExtractTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [providerDraft, setProviderDraft] = useState<LlmProvider>("anthropic");
  const [suggestedIdentities, setSuggestedIdentities] = useState<SuggestedIdentity[]>([]);
  const [scoutingEntities, setScoutingEntities] = useState(false);
  const [setupPaste, setSetupPaste] = useState("");
  const [viewDay, setViewDay] = useState("");
  const [viewAllDates, setViewAllDates] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("full");
  const [customStart, setCustomStart] = useState("00:00");
  const [customEnd, setCustomEnd] = useState("23:59");
  const [tickPreset, setTickPreset] = useState<TickPreset>("1h");
  const [pxPerHour, setPxPerHour] = useState(80);
  const [viewportFit, setViewportFit] = useState(true);
  const [dateMenu, setDateMenu] = useState(false);
  const [timeMenu, setTimeMenu] = useState(false);
  const [operatorMenu, setOperatorMenu] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [resetPrompt, setResetPrompt] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const operator = hydrateUserProfile(useLiveQuery(
    () => db.userProfile.get(OPERATOR_ID).catch(() => undefined),
    [],
  ));
  const operatorInitials = (
    operator.avatarInitials?.trim()
    || computeAvatarInitials(operator.firstName, operator.lastName)
  ).slice(0, 3);
  const creatorLabel = operator.creatorName || DEFAULT_OPERATOR.creatorName;
  const [focusEventId, setFocusEventId] = useState<string | null>(null);

  useEffect(() => {
    applyThemePreference(operator.themePreference ?? "system");
  }, [operator.themePreference]);

  useEffect(() => {
    const onPop = () => setScreen(screenFromPath(window.location.pathname) ?? "Hub");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goTo = (next: Screen) => {
    setScreen(next);
    setOperatorMenu(false);
    const path = pathFromScreen(next);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  };

  useEffect(() => {
    const path = pathFromScreen(screen);
    if (window.location.pathname !== path) window.history.replaceState({}, "", path);
  }, [screen]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!ingestJob || ingestJob.stage === "done") return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [ingestJob?.evidenceId, ingestJob?.stage]);

  useEffect(() => {
    if (!drawerEventId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerEventId(null);
      setDrawerEdit(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerEventId]);

  const GLOBAL_NAV: { id: Screen; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "Hub", icon: LayoutGrid },
  ];
  const CASE_NAV: { id: Screen; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { id: "Setup", icon: ListChecks },
    { id: "Overview", icon: LayoutDashboard },
    { id: "Intake", icon: Inbox, badge: caseEvidence.length || undefined },
    { id: "Verify", icon: ShieldCheck, badge: pendingDrafts.length || undefined },
    { id: "Timeline", icon: GitCommitHorizontal },
    { id: "Graph", icon: GitFork, badge: (screen !== "Hub" && caseRelationships.length) || undefined },
  ];

  const ensureActiveCase = async () => {
    if (activeCaseId && activeCaseId !== "" && hubCases?.some((c) => c.id === activeCaseId)) return activeCaseId;
    if (!draftTitle.trim()) return null;
    const row = await createCase({
      title: draftTitle,
      summary: draftSummary,
      status: draftStatus,
    });
    setActiveCaseId(row.id);
    return row.id;
  };

  const openForm = (kind: EntityKind, src: EntityRecord | null) => {
    const blank: Record<string, string> = {};
    SCHEMA[kind].fields.forEach((f) => { blank[f.k] = ""; });
    setForm({
      tab: kind,
      id: src?.id ?? null,
      name: src?.name ?? "",
      chip: src?.role && SCHEMA[kind].statuses.includes(kind === "People" ? normalizePersonRole(src.role) : src.role)
        ? (kind === "People" ? normalizePersonRole(src.role) : src.role)
        : SCHEMA[kind].statuses[SCHEMA[kind].statuses.length - 1],
      v: { ...blank, note: src?.notes ?? "" },
    });
  };

  const saveForm = async () => {
    if (!form) return;
    const caseId = await ensureActiveCase();
    if (!caseId) {
      setStep(0);
      return;
    }
    const payload = {
      name: form.name.trim() || `Untitled ${SCHEMA[form.tab].noun}`,
      type: KIND_TYPE[form.tab],
      role: form.tab === "People" ? normalizePersonRole(form.chip) : form.chip,
      notes: notesFromForm(form.v),
    };
    if (form.id) await updateEntity(form.id, payload);
    else await createEntity({ caseId, ...payload });
    setForm(null);
  };

  const removeEntity = async () => {
    if (!form?.id) return;
    await deleteEntity(form.id);
    setForm(null);
  };

  const chrono = useMemo(() => {
    const entityMap = new Map(caseEntities.map((e) => [e.id, e]));
    const places = caseEntities.filter((e) => e.type === "place");
    const dayKeys = uniqueDayKeys(caseEvents.map((e) => e.timestamp));
    const dayCounts: Record<string, number> = {};
    for (const e of caseEvents) {
      const key = localDayKey(e.timestamp);
      dayCounts[key] = (dayCounts[key] ?? 0) + 1;
    }
    const busiest = busiestDayKey(caseEvents.map((e) => e.timestamp));
    const activeDay = viewDay || busiest;
    const { startH, endH } = windowHours(timeWindow, customStart, customEnd);

    let scoped = caseEvents;
    if (!viewAllDates && activeDay) {
      scoped = scoped.filter((e) => localDayKey(e.timestamp) === activeDay);
    }
    if (timeWindow !== "full") {
      scoped = scoped.filter((e) => eventInHourWindow(e.timestamp, startH, endH));
    }

    const fallbackStart = activeDay
      ? Date.parse(`${activeDay}T00:00:00`)
      : Date.now();
    let start: number;
    let end: number;
    if (viewportFit || viewAllDates || timeWindow === "full") {
      const bounds = paddedBounds(scoped.map((e) => e.timestamp), Number.isNaN(fallbackStart) ? Date.now() : fallbackStart);
      start = bounds.minTime;
      end = bounds.maxTime;
    } else if (activeDay) {
      const [y, m, d] = activeDay.split("-").map(Number);
      start = new Date(y, (m ?? 1) - 1, d ?? 1, Math.floor(startH), Math.round((startH % 1) * 60), 0, 0).getTime();
      if (endH >= 24) {
        end = new Date(y, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0).getTime();
      } else {
        end = new Date(y, (m ?? 1) - 1, d ?? 1, Math.floor(endH), Math.round((endH % 1) * 60), 0, 0).getTime();
      }
    } else {
      const bounds = paddedBounds(scoped.map((e) => e.timestamp), Date.now());
      start = bounds.minTime;
      end = bounds.maxTime;
    }
    if (end <= start) end = start + 2 * HOUR_MS;

    const hours = (end - start) / HOUR_MS;
    const tickMs = tickMsFor(tickPreset);
    const xOf = (ts: number) => LANE_PAD + ((ts - start) / HOUR_MS) * pxPerHour;

    const mentionsPlace = (blob: string, place: EntityRecord) =>
      blob.toLowerCase().includes(place.name.toLowerCase());

    const conflictIds = new Set<string>();
    const conflictPairs: { aId: string; bId: string; label: string; detail: string }[] = [];
    const addPair = (aId: string, bId: string, label: string, detail: string) => {
      if (conflictIds.has(aId) && conflictIds.has(bId)) return;
      conflictIds.add(aId);
      conflictIds.add(bId);
      conflictPairs.push({ aId, bId, label, detail });
    };

    if (caseEvents.some((e) => e.id === "te-a1") && caseEvents.some((e) => e.id === "te-t2")) {
      addPair("te-a1", "te-t2", "Impossible transit", "The motel alibi cannot coexist with the Gate 4 toll exit.");
    }

    const byEntity = new Map<string, TimelineEventRecord[]>();
    caseEvents.forEach((e) => {
      const list = byEntity.get(e.entityId) ?? [];
      list.push(e);
      byEntity.set(e.entityId, list);
    });
    for (const evs of byEntity.values()) {
      const sorted = [...evs].sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const a = sorted[i], b = sorted[i + 1];
        const dt = b.timestamp - a.timestamp;
        if (dt <= 0 || dt > TRANSIT_CONFLICT_MS) continue;
        const blobA = `${a.title} ${a.description}`;
        const blobB = `${b.title} ${b.description}`;
        const pa = places.filter((p) => mentionsPlace(blobA, p));
        const pb = places.filter((p) => mentionsPlace(blobB, p));
        const disjoint = pa.some((p) => !pb.some((q) => q.id === p.id)) && pb.some((p) => !pa.some((q) => q.id === p.id));
        if (!disjoint) continue;
        const mins = Math.round(dt / 60000);
        addPair(a.id, b.id, "Impossible transit", `${mins} min between ${pa[0].name} and ${pb[0].name}.`);
      }
    }

    const plotted = scoped.map((e) => {
      const laneId = entityMap.has(e.entityId) ? e.entityId : UNASSIGNED_LANE_ID;
      const ent = entityMap.get(e.entityId);
      const semantic = resolveSemanticCategory({
        entityType: ent?.type,
        role: ent?.role,
        name: ent?.name,
        text: `${e.title} ${e.description}`,
      });
      return {
        id: e.id,
        entityId: laneId,
        sourceEntityId: e.entityId,
        timestamp: e.timestamp,
        time: formatClock(e.timestamp),
        title: e.title,
        sub: e.description,
        tag: e.isVerified ? "EVENT" : "UNVERIFIED",
        flag: conflictIds.has(e.id),
        verified: e.isVerified,
        semantic,
      };
    });

    const laneIds = [...new Set([
      ...caseEvents.map((e) => (entityMap.has(e.entityId) ? e.entityId : UNASSIGNED_LANE_ID)),
      ...plotted.map((e) => e.entityId),
    ])];
    laneIds.sort((a, b) => {
      if (a === UNASSIGNED_LANE_ID) return 1;
      if (b === UNASSIGNED_LANE_ID) return -1;
      return (entityMap.get(a)?.name ?? a).localeCompare(entityMap.get(b)?.name ?? b);
    });

    const anchors: Record<string, { x: number; top: number; bottom: number }> = {};
    let top = RULER_H;
    const lanes = laneIds.map((id) => {
      const ent = entityMap.get(id);
      const semantic = resolveSemanticCategory({
        entityType: ent?.type ?? (id === UNASSIGNED_LANE_ID ? "" : "person"),
        role: ent?.role,
        name: ent?.name,
        text: ent?.notes,
      });
      const def = {
        id,
        name: id === UNASSIGNED_LANE_ID ? "Unassigned" : (ent?.name ?? "Unknown entity"),
        role: ent?.role ?? "",
        note: ent?.notes ?? "",
        type: (ent?.type ?? "person") as EntityType,
        category: { entityType: ent?.type, role: ent?.role, name: ent?.name, text: ent?.notes },
        dot: getCategoryColor(semantic, "dot"),
        border: getCategoryColor(semantic, "border"),
        semantic,
        tone: TONE_FOR[normalizePersonRole(ent?.role ?? "")] ?? TONE_FOR[ent?.role ?? ""] ?? ("cold" as Tone),
      };
      const evs = plotted.filter((e) => e.entityId === id).sort((a, b) => a.timestamp - b.timestamp);
      const totalCount = caseEvents.filter((e) => (entityMap.has(e.entityId) ? e.entityId : UNASSIGNED_LANE_ID) === id).length;
      const rowEnds: number[] = [];
      let maxStack = 0;
      const placed = evs.map((e) => {
        const left = xOf(e.timestamp);
        let row = 0;
        while (row < rowEnds.length && rowEnds[row] > left) row += 1;
        if (row === rowEnds.length) rowEnds.push(0);
        rowEnds[row] = left + CARD_W + CARD_PAD;
        maxStack = Math.max(maxStack, row);
        return { e, row, left };
      });
      const tracks = maxStack + 1;
      const height = 12 + tracks * (CARD_H + CARD_GAP) - CARD_GAP + 12;
      const laneTop = top;
      placed.forEach(({ e, row, left }) => {
        const cardTop = 10 + row * (CARD_H + CARD_GAP);
        if (e.flag) {
          anchors[e.id] = { x: left + CARD_W / 2, top: laneTop + cardTop, bottom: laneTop + cardTop + CARD_H };
        }
      });
      top += height + 1;
      return { def, height, placed, count: totalCount, tracks };
    });

    const firstPair = conflictPairs[0];
    const A = firstPair ? anchors[firstPair.aId] : undefined;
    const B = firstPair ? anchors[firstPair.bId] : undefined;
    const tether = A && B && firstPair
      ? {
          id: `${firstPair.aId}::${firstPair.bId}`,
          aId: firstPair.aId,
          bId: firstPair.bId,
          midY: (A.bottom + B.top) / 2,
          midX: (A.x + B.x) / 2,
          A,
          B,
          label: firstPair.label,
          detail: firstPair.detail,
          count: conflictPairs.length,
        }
      : null;

    const ticks: number[] = [];
    let step = tickMs;
    while ((end - start) / step > 64) step *= 2;
    for (let t = start; t <= end + 1; t += step) ticks.push(t);

    return {
      all: plotted,
      lanes,
      tether,
      start,
      end,
      hours,
      ticks,
      tickMs,
      pxPerHour,
      width: LANE_PAD + hours * pxPerHour + 80,
      xOf,
      rangeLabel: formatRangeLabel(start, end, viewAllDates || dayKeys.length > 1),
      dayKeys,
      dayCounts,
      busiest,
      activeDay,
      dayLabel: viewAllDates ? "ALL DATES" : (activeDay ? formatDayHeading(activeDay) : "NO DATE"),
      timeLabel: formatClockRange(start, end),
    };
  }, [caseEvents, caseEntities, viewDay, viewAllDates, timeWindow, customStart, customEnd, tickPreset, pxPerHour, viewportFit]);

  useEffect(() => {
    setViewDay("");
    setViewAllDates(false);
    setViewportFit(true);
    setTimeWindow("full");
    setTickPreset("1h");
    setDateMenu(false);
    setTimeMenu(false);
  }, [resolvedCaseId]);

  useEffect(() => {
    if (screen !== "Timeline" || !viewportFit || !caseEvents.length) return;
    const active = viewDay || busiestDayKey(caseEvents.map((e) => e.timestamp));
    const pool = viewAllDates
      ? caseEvents
      : caseEvents.filter((e) => localDayKey(e.timestamp) === active);
    const times = (pool.length ? pool : caseEvents).map((e) => e.timestamp);
    const { minTime, maxTime } = paddedBounds(times, Date.now());
    const width = timelineContainerRef.current?.clientWidth ?? 960;
    setPxPerHour(fitPxPerHour(maxTime - minTime, width));
  }, [screen, viewportFit, resolvedCaseId, caseEvents, viewDay, viewAllDates]);

  const fitToEvents = () => {
    setViewportFit(true);
    setTimeWindow("full");
    const active = viewDay || busiestDayKey(caseEvents.map((e) => e.timestamp));
    const pool = viewAllDates || !active
      ? caseEvents
      : caseEvents.filter((e) => localDayKey(e.timestamp) === active);
    const times = (pool.length ? pool : caseEvents).map((e) => e.timestamp);
    const { minTime, maxTime } = paddedBounds(times, Date.now());
    const el = timelineContainerRef.current;
    setPxPerHour(fitPxPerHour(maxTime - minTime, el?.clientWidth ?? 960));
    requestAnimationFrame(() => el?.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  };

  const list = caseEntities.filter((e) => e.type === KIND_TYPE[tab]);

  const inspectContradiction = (contradictionId?: string) => {
    setSelected(null);
    setPendingInspectId(`${contradictionId ?? chrono.tether?.id ?? "primary"}:${Date.now()}`);
    if (screen !== "Timeline") setScreen("Timeline");
  };

  const focusContradictionInViewport = () => {
    const el = timelineContainerRef.current;
    const t = chrono.tether;
    if (!el || !t) return;
    const viewCenterX = LANE_PAD + Math.max(80, el.clientWidth - LANE_PAD) / 2;
    const targetScrollX = Math.max(0, Math.min(Math.round(t.midX - viewCenterX), Math.max(0, el.scrollWidth - el.clientWidth)));
    const targetScrollY = Math.max(0, Math.min(Math.round(t.midY - el.clientHeight / 2), Math.max(0, el.scrollHeight - el.clientHeight)));
    el.scrollTo({ left: targetScrollX, top: targetScrollY, behavior: "smooth" });

    const finish = () => {
      if (inspectLock.current) return;
      inspectLock.current = true;
      const half = 160;
      const height = 300;
      const visLeft = el.scrollLeft + LANE_PAD + 16 + half;
      const visRight = el.scrollLeft + el.clientWidth - 16 - half;
      let left = t.midX;
      if (visRight > visLeft) left = Math.min(Math.max(left, visLeft), visRight);
      let top = t.midY + 22;
      if (top + height > el.scrollTop + el.clientHeight - 12) {
        top = Math.max(el.scrollTop + 12, t.midY - height - 14);
      }
      setPopoverAnchor({ left, top });
      setPopover(true);
      setConflictPulse((n) => n + 1);
      window.setTimeout(() => { inspectLock.current = false; }, 700);
    };

    const onEnd = () => {
      el.removeEventListener("scrollend", onEnd);
      finish();
    };
    el.addEventListener("scrollend", onEnd);
    window.setTimeout(() => {
      el.removeEventListener("scrollend", onEnd);
      finish();
    }, 480);
  };

  useEffect(() => {
    if (screen !== "Timeline" || !pendingInspectId) return;
    const timer = window.setTimeout(() => {
      focusContradictionInViewport();
      setPendingInspectId(null);
    }, 70);
    return () => window.clearTimeout(timer);
  }, [screen, pendingInspectId, chrono.tether?.id]);

  useEffect(() => {
    if (!conflictPulse) return;
    const timer = window.setTimeout(() => setConflictPulse(0), 2000);
    return () => window.clearTimeout(timer);
  }, [conflictPulse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (screen !== "Timeline" || !focusEventId) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`timeline-node-${focusEventId}`);
      node?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      openEventDrawer(focusEventId);
      setFocusEventId(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [screen, focusEventId]);

  const applySearchHit = (hit: SearchHit) => {
    setSearchOpen(false);
    setActiveCaseId(hit.caseId);
    if (hit.kind === "case") {
      setScreen("Overview");
      return;
    }
    if (hit.kind === "entity") {
      const entityId = hit.id.slice("entity:".length);
      setSelected(entityId);
      setScreen("Timeline");
      const ent = caseEntities.find((e) => e.id === entityId);
      if (ent) openForm(TYPE_KIND[ent.type], ent);
      else {
        void db.entities.get(entityId).then((row) => {
          if (row) openForm(TYPE_KIND[row.type], row);
        });
      }
      return;
    }
    if (hit.kind === "event") {
      const eventId = hit.id.slice("event:".length);
      setScreen("Timeline");
      setFocusEventId(eventId);
      return;
    }
    if (hit.kind === "evidence") {
      const evidenceId = hit.id.slice("evidence:".length);
      setActiveEvidenceId(evidenceId);
      setScreen("Verify");
      return;
    }
    setScreen("Overview");
  };

  const openNewCase = () => {
    setActiveCaseId("");
    setDraftTitle("");
    setDraftSummary("");
    setDraftStatus("ACTIVE");
    setStep(0);
    setSuggestedIdentities([]);
    setSetupPaste("");
    setScreen("Setup");
  };

  const openExistingCase = (id: string, title: string, summary: string, status: string) => {
    setActiveCaseId(id);
    setDraftTitle(title);
    setDraftSummary(summary);
    setDraftStatus((CASE_STATUSES.includes(status as CaseStatus) ? status : "ACTIVE") as CaseStatus);
    setStep(2);
    setScreen("Overview");
  };

  const unarchiveCase = async (id: string, title: string) => {
    await setCaseArchived(id, false);
    setHubCardMenuId(null);
    setToast(`${title} restored to active cases.`);
  };

  const confirmArchiveCase = async () => {
    if (!archivePrompt) return;
    const { id, title } = archivePrompt;
    await setCaseArchived(id, true);
    setArchivePrompt(null);
    setHubCardMenuId(null);
    if (activeCaseId === id) setActiveCaseId("");
    setHubTab("archived");
    goTo("Hub");
    setToast(`${title} moved to archive.`);
  };

  const submitNewCase = async () => {
    if (!draftTitle.trim() || savingCase) return;
    setSavingCase(true);
    try {
      if (activeCaseId && hubCases?.some((c) => c.id === activeCaseId)) {
        await updateCase(activeCaseId, { title: draftTitle, summary: draftSummary, status: draftStatus });
        setScreen("Overview");
        return;
      }
      const row = await createCase({
        title: draftTitle,
        summary: draftSummary,
        status: draftStatus,
      });
      setActiveCaseId(row.id);
      setScreen("Overview");
      setStep(0);
    } finally {
      setSavingCase(false);
    }
  };

  const openAddEvent = () => {
    const first = selected && caseEntities.some((e) => e.id === selected)
      ? selected
      : caseEntities[0]?.id ?? "";
    const base = caseEvents.length
      ? caseEvents[caseEvents.length - 1].timestamp + 30 * 60 * 1000
      : (chrono.activeDay ? Date.parse(`${chrono.activeDay}T12:00:00`) : Date.now());
    setEventEntityId(first);
    setEventWhen(toDatetimeLocal(base));
    setEventTitle("");
    setEventDesc("");
    setEventOpen(true);
  };

  const submitEvent = async () => {
    if (!resolvedCaseId || !eventEntityId || !eventTitle.trim() || !eventWhen || savingEvent) return;
    setSavingEvent(true);
    try {
      await createTimelineEvent({
        caseId: resolvedCaseId,
        entityId: eventEntityId,
        timestamp: new Date(eventWhen).getTime(),
        title: eventTitle,
        description: eventDesc,
      });
      setSelected(eventEntityId);
      setEventOpen(false);
    } finally {
      setSavingEvent(false);
    }
  };

  const openEventDrawer = (id: string) => {
    const ev = caseEvents.find((e) => e.id === id);
    if (!ev) return;
    setDrawerEventId(id);
    setDrawerEdit(false);
    setDrawerTitle(ev.title);
    setDrawerWhen(toDatetimeLocal(ev.timestamp));
    setDrawerDesc(ev.description);
    setDrawerEntityId(ev.entityId);
  };

  const persistDrawerStamp = async (date: string, time: string) => {
    if (!drawerEventId) return;
    const ts = joinLocalDateTime(date, time);
    if (ts == null) return;
    setDrawerWhen(toDatetimeLocal(ts));
    await updateTimelineEvent(drawerEventId, { timestamp: ts });
  };

  const saveEventDrawer = async () => {
    if (!drawerEventId || !drawerTitle.trim() || !drawerWhen || savingDrawer) return;
    setSavingDrawer(true);
    try {
      await updateTimelineEvent(drawerEventId, {
        title: drawerTitle.trim(),
        description: drawerDesc,
        timestamp: new Date(drawerWhen).getTime(),
        entityId: drawerEntityId || undefined,
      });
      setDrawerEdit(false);
    } finally {
      setSavingDrawer(false);
    }
  };

  const deleteEventFromTimeline = async () => {
    if (!drawerEventId) return;
    await deleteTimelineEvent(drawerEventId);
    setDrawerEventId(null);
    setDrawerEdit(false);
  };

  const ingestText = async (input: {
    fileName: string;
    fileType: string;
    rawText: string;
    fileSize?: number;
    pageCount?: number;
    flagged?: boolean;
    imageBase64?: string;
    fileBase64?: string;
    thumbnailDataUrl?: string;
    mediaType?: string;
    sha256Hash?: string;
    mimeType?: string;
    originalFileName?: string;
    sourceType?: "pdf" | "image" | "text" | "web_article";
    sourceUrl?: string;
    publishedDate?: string;
    wordCount?: number;
  }) => {
    let rowId: string | null = null;
    const startedAt = Date.now();
    try {
      const caseId = resolvedCaseId ?? await ensureActiveCase();
      if (!caseId) {
        setExtractError("Create or open a case before adding evidence.");
        setScreen("Setup");
        return null;
      }
      const sha256Hash = input.sha256Hash
        || await calculateSHA256FromText(input.rawText || "");
      if (Date.now() - startedAt > STAGE_TIMEOUT_MS) throw new Error(STAGE_TIMEOUT_ERROR);
      const row = await addEvidence({
        caseId,
        fileName: input.fileName,
        fileType: input.fileType,
        rawText: input.rawText,
        fileSize: input.fileSize,
        byteSize: input.fileSize,
        pageCount: input.pageCount,
        imageBase64: input.imageBase64,
        fileBase64: input.fileBase64,
        thumbnailDataUrl: input.thumbnailDataUrl,
        mediaType: input.mediaType,
        mimeType: input.mimeType || input.mediaType,
        sha256Hash,
        ingestedByCallsign: creatorLabel,
        originalFileName: input.originalFileName || input.fileName,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        publishedDate: input.publishedDate,
        wordCount: input.wordCount,
      });
      rowId = row.id;
      if (Date.now() - startedAt > STAGE_TIMEOUT_MS) throw new Error(STAGE_TIMEOUT_ERROR);
      if (input.flagged) await db.evidence.update(row.id, { status: "flagged", lastError: "" });
      else await db.evidence.update(row.id, { status: "indexed", lastError: "" });
      setActiveEvidenceId(row.id);
      setExtractError(null);
      return { ...row, status: input.flagged ? "flagged" as const : "indexed" };
    } catch (err) {
      const message = stagingFailureMessage(err);
      if (rowId) await clearIngestingAsFailed(rowId, err);
      setExtractError(message);
      const fail = new Error(message) as Error & { evidenceId?: string };
      fail.evidenceId = rowId ?? undefined;
      throw fail;
    } finally {
      if (rowId) {
        const rec = await db.evidence.get(rowId);
        if (rec?.status === "ingesting") {
          await db.evidence.update(rowId, {
            status: "failed",
            lastError: STAGE_SIZE_ERROR,
          });
        }
      }
    }
  };

  const ingestFiles = async (files: FileList | File[], opts?: { extract?: boolean }) => {
    const extract = opts?.extract ?? screen === "Intake";
    for (const file of [...files]) {
      let rowId: string | null = null;
      try {
        if (!isPdfFile(file) && !isImageFile(file) && !isTextFile(file)) {
          setExtractError(`Skipped ${file.name} — use PDF, image (PNG, JPG, WEBP), TXT, MD, CSV, or JSON.`);
          continue;
        }
        const row = await stageEvidenceFile(file, (payload) => ingestText(payload));
        if (!row) continue;
        rowId = row.id;
        if (extract) await runExtract(rowId);
      } catch (err) {
        const message = stagingFailureMessage(err);
        const fromPersist = err instanceof Error && "evidenceId" in err
          ? String((err as Error & { evidenceId?: string }).evidenceId || "")
          : "";
        const failId = rowId || fromPersist;
        if (failId) {
          await clearIngestingAsFailed(failId, err);
        } else {
          try {
            const caseId = resolvedCaseId ?? await ensureActiveCase();
            if (caseId) {
              const stub = await addEvidence({
                caseId,
                fileName: file.name,
                fileType: file.name.split(".").pop() || "bin",
                rawText: "",
                fileSize: file.size,
                originalFileName: file.name,
              });
              await clearIngestingAsFailed(stub.id, err);
              setActiveEvidenceId(stub.id);
            }
          } catch {
            /* still surface the original failure */
          }
        }
        setExtractError(message);
        window.alert(message);
      } finally {
        if (rowId && !extract) {
          const rec = await db.evidence.get(rowId);
          if (rec?.status === "ingesting") {
            await db.evidence.update(rowId, { status: "failed", lastError: STAGE_SIZE_ERROR });
          }
        }
      }
    }
  };

  const ingestWebArticle = async (url: string, onProgress: (stage: "scraping" | "staging") => void) => {
    onProgress("scraping");
    const article = await scrapeArticleFromUrl(url);
    onProgress("staging");
    const sha256Hash = await calculateSHA256(
      new TextEncoder().encode(article.content).buffer as ArrayBuffer,
    );
    const bytes = new TextEncoder().encode(article.content).length;
    await ingestText({
      fileName: article.title,
      fileType: "web_article",
      rawText: article.content,
      fileSize: bytes,
      mimeType: "text/html",
      sha256Hash,
      originalFileName: article.url,
      sourceType: "web_article",
      sourceUrl: article.url,
      publishedDate: article.publishedDate ?? undefined,
      wordCount: article.wordCount,
    });
  };

  const runOfficialExport = async (opts: DossierExportOptions) => {
    if (!activeCase) {
      setExportError("Open a case before exporting.");
      return;
    }
    if (operator.permissions?.canExportDossier === false) {
      setExportError("This operator profile cannot export INTELLIDEX packs.");
      return;
    }
    setExportBusy(true);
    setExportError(null);
    try {
      await generateAndDownloadDossier({
        case: activeCase,
        entities: caseEntities,
        evidence: caseEvidence,
        events: caseEvents,
        operator,
      }, opts);
      setExportOpen(false);
      setToast("Official INTELLIDEX pack downloaded locally.");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const runExtract = async (evidenceId?: string, opts?: {
    startedAt?: number;
    maxPages?: number;
    maxChars?: number;
    summary?: boolean;
  }) => {
    const caseId = resolvedCaseId ?? await ensureActiveCase();
    if (!caseId) {
      setExtractError("Create or open a case first.");
      return;
    }
    const targetId = evidenceId ?? activeEvidenceId ?? caseEvidence[0]?.id;
    const ev = (targetId ? await db.evidence.get(targetId) : undefined)
      ?? caseEvidence.find((e) => e.id === targetId);
    if (!ev) {
      setExtractError("Add or paste source text before extracting.");
      return;
    }
    const canVision = Boolean(ev.fileBase64 || ev.imageBase64);
    if (!canVision && (!ev.rawText.trim() || isUnreadableScan(ev.rawText))) {
      const message = UNREADABLE_SCAN_ALERT;
      await db.evidence.update(ev.id, { status: "failed", lastError: message, textClarity: "low" });
      setExtractError(message);
      return;
    }
    if (!canVision) logExtractedText(ev.rawText, ev.fileName);
    const startedAt = opts?.startedAt ?? Date.now();
    setExtracting(true);
    setExtractError(null);
    await db.evidence.update(ev.id, { status: "ingesting", lastError: "" });
    setActiveEvidenceId(ev.id);
    setIngestJob({
      evidenceId: ev.id,
      stage: (ev.fileType === "pdf" || ev.mediaType === "application/pdf") && ev.fileBase64 ? "render" : "claude",
      currentPage: 0,
      totalPages: Math.min(opts?.maxPages ?? CLAUDE_RETRY_PAGES, ev.pageCount || CLAUDE_RETRY_PAGES),
      startedAt,
      llmStartedAt: (ev.fileType === "pdf" || ev.mediaType === "application/pdf") && ev.fileBase64 ? null : Date.now(),
    });
    try {
      const hints = caseEntities.map((e) => ({ id: e.id, name: e.name, type: e.type, role: e.role }));
      const isPdf = (ev.fileType === "pdf" || ev.mediaType === "application/pdf") && Boolean(ev.fileBase64);
      const pageCap = opts?.maxPages ?? CLAUDE_RETRY_PAGES;
      const bundle = isPdf && ev.fileBase64
        ? await (async () => {
            const rendered = await renderPdfPagesToJpeg(ev.fileBase64!, {
              maxPages: pageCap,
              scale: 1.5,
              quality: 0.8,
              onProgress: (current, total) => {
                setIngestJob((job) => (job && job.evidenceId === ev.id
                  ? { ...job, stage: "render", currentPage: current, totalPages: total }
                  : job));
              },
            });
            if (rendered.pageCount && rendered.pageCount !== ev.pageCount) {
              await db.evidence.update(ev.id, { pageCount: rendered.pageCount });
            }
            setIngestJob((job) => (job && job.evidenceId === ev.id
              ? { ...job, stage: "claude", llmStartedAt: Date.now(), currentPage: rendered.pages.length, totalPages: rendered.pages.length }
              : job));
            return extractEventsFromRenderedPages({
              fileName: ev.fileName,
              pages: rendered.pages,
              entities: hints,
            });
          })()
        : (ev.imageBase64 || (ev.fileBase64 && (ev.mediaType || "").startsWith("image/")))
          ? await extractEventsFromImage({
              imageBase64: ev.imageBase64,
              fileBase64: ev.fileBase64 || ev.imageBase64,
              mediaType: ev.mediaType || "image/jpeg",
              fileName: ev.fileName,
              entities: hints,
            })
          : await extractEventsFromText({
        text: windowSourceText(ev.rawText, {
          maxPages: opts?.maxPages ?? CLAUDE_MAX_PAGES,
          maxChars: opts?.maxChars ?? CLAUDE_MAX_CHARS,
        }),
        fileName: ev.fileName,
        entities: hints,
        summary: opts?.summary,
        maxPages: opts?.maxPages ?? CLAUDE_MAX_PAGES,
        maxChars: opts?.maxChars ?? CLAUDE_MAX_CHARS,
      });
      const events = bundle.events;
      await applyExtractedGraph({
        caseId,
        evidenceId: ev.id,
        entities: bundle.entities,
        relationships: bundle.relationships,
      });
      setIngestJob((job) => (job && job.evidenceId === ev.id ? { ...job, stage: "events" } : job));
      const clarity = ev.textClarity ?? assessTextClarity(ev.rawText, ev.pageCount ?? 1);
      if (!events.length) {
        const message = "Claude returned no events. Try a shorter excerpt or paste narrative text.";
        await db.evidence.update(ev.id, { status: "flagged", lastError: message, textClarity: clarity });
        setExtractError(message);
        setIngestJob(null);
        return;
      }
      const matchEntity = (id: string | null, name: string) => {
        if (id && caseEntities.some((e) => e.id === id)) return id;
        const needle = name.trim().toLowerCase();
        if (!needle) return "";
        return caseEntities.find((e) => e.name.trim().toLowerCase() === needle)?.id
          ?? caseEntities.find((e) => namesLooselyMatch(e.name, name))?.id
          ?? caseEntities.find((e) => {
            const n = e.name.trim().toLowerCase();
            return n.includes(needle) || needle.includes(n);
          })?.id
          ?? "";
      };
      await addVerifyDrafts(events.map((event) => {
        const entityId = matchEntity(event.entityId, event.entityName);
        return {
          caseId,
          evidenceId: ev.id,
          timestamp: parseEventTime(event.timestamp, event.timestampLabel, {
            extraText: `${event.details} ${event.rawQuote} ${event.citation} ${ev.rawText.slice(0, 2500)}`,
          }),
          timestampLabel: event.timestampLabel || event.timestamp || "Unknown",
          entityId,
          entityName: event.entityName,
          suggestNewEntity: !entityId,
          newEntityType: event.newEntityType ?? event.entityType ?? "",
          category: event.category,
          title: event.title,
          snippet: event.rawQuote || event.snippet,
          details: event.details,
          confidence: event.confidence,
          citation: event.citation,
          sourceCitation: {
            sourceId: ev.id,
            sourceName: ev.fileName,
            sourceType: inferSourceType(ev),
            pageNumber: event.pageNumber,
            exactQuote: event.exactQuote || event.rawQuote || event.snippet,
            boundingBox: event.boundingBox,
            sourceUrl: ev.sourceUrl,
          },
        };
      }), { replacePendingForEvidence: ev.id });
      setIngestJob((job) => (job && job.evidenceId === ev.id ? { ...job, stage: "done" } : job));
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setActiveEvidenceId(ev.id);
      setScreen("Verify");
      setIngestJob(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed.";
      await db.evidence.update(ev.id, { status: "failed", lastError: message });
      setExtractError(message);
      setIngestJob(null);
    } finally {
      setExtracting(false);
    }
  };

  const continueToEntities = async () => {
    const sources = caseEvidence.filter((e) => e.rawText.trim());
    if (!sources.length) {
      setSuggestedIdentities([]);
      setStep(2);
      return;
    }
    setScoutingEntities(true);
    setExtractError(null);
    try {
      const found = await scoutEntitiesFromText({
        text: windowSourceText(sources.map((s) => `--- ${s.fileName} ---\n${s.rawText}`).join("\n\n")),
        fileName: sources.map((s) => s.fileName).join(", "),
        entities: caseEntities.map((e) => ({ id: e.id, name: e.name, type: e.type, role: e.role })),
      });
      const existing = new Set(caseEntities.map((e) => `${e.type}:${e.name.trim().toLowerCase()}`));
      const seen = new Set<string>();
      const next: SuggestedIdentity[] = [];
      for (const f of found) {
        const key = `${f.type}:${f.name.trim().toLowerCase()}`;
        if (existing.has(key) || seen.has(key)) continue;
        seen.add(key);
        next.push({ ...f, id: crypto.randomUUID() });
      }
      setSuggestedIdentities(next);
      setStep(2);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Could not scout entities from sources.");
      setSuggestedIdentities([]);
      setStep(2);
    } finally {
      setScoutingEntities(false);
    }
  };

  const acceptSuggested = async (item: SuggestedIdentity) => {
    const caseId = resolvedCaseId ?? await ensureActiveCase();
    if (!caseId) {
      setStep(0);
      return;
    }
    await createEntity({
      caseId,
      name: item.name,
      type: item.type,
      role: scoutRole(item.type, item.role),
      notes: [item.details, item.quote && `“${item.quote}”`, item.sourceFile && `Source: ${item.sourceFile}`]
        .filter(Boolean)
        .join("\n"),
    });
    setSuggestedIdentities((rows) => rows.filter((r) => r.id !== item.id));
    setTab(TYPE_KIND[item.type]);
  };

  const sourceEvidence = caseEvidence.find((e) => e.id === activeEvidenceId) ?? caseEvidence[0] ?? null;
  const drawerEvent = caseEvents.find((e) => e.id === drawerEventId) ?? null;
  const drawerEntity = drawerEvent ? caseEntities.find((e) => e.id === drawerEvent.entityId) : null;
  const drawerSource = drawerEvent ? caseEvidence.find((e) => e.id === drawerEvent.sourceDocId) : null;
  const pdfProgress = ingestJob?.stage === "pdf" || ingestJob?.stage === "render" ? ingestStageLabel(ingestJob) : null;
  const jobElapsed = ingestJob ? ingestElapsedSec(ingestJob, nowMs) : 0;
  const busy = extracting || (ingestJob != null && ingestJob.stage !== "done");

  const sourceQuoteSpans = useMemo(
    () => collectQuoteSpans(sourceEvidence?.rawText ?? "", pendingDrafts),
    [sourceEvidence?.rawText, pendingDrafts],
  );
  const sourceQuoteSegments = useMemo(
    () => splitTextBySpans(sourceEvidence?.rawText ?? "", sourceQuoteSpans),
    [sourceEvidence?.rawText, sourceQuoteSpans],
  );
  const narrativeQueue = useMemo(
    () => {
      const byEvidence = new Map(caseEvidence.map((row) => [row.id, row.rawText] as const));
      const current = sourceEvidence?.rawText ?? "";
      const ordered = sortByNarrativeOrder(pendingDrafts, (draft) => {
        if (current && Number.isFinite(narrativeSortKey(current, draft.snippet))) return current;
        return byEvidence.get(draft.evidenceId) || current;
      });
      const manual = ordered.filter((d) => d.citation === "selection");
      const rest = ordered.filter((d) => d.citation !== "selection");
      return [...manual, ...rest];
    },
    [caseEvidence, pendingDrafts, sourceEvidence?.rawText],
  );

  const captureSourceSelection = () => {
    const sel = window.getSelection();
    const pane = sourcePaneRef.current;
    if (!sel || sel.isCollapsed || !pane || !sel.anchorNode || !pane.contains(sel.anchorNode)) {
      setExtractTip(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 8) {
      setExtractTip(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setExtractTip({ text, x: rect.left + rect.width / 2, y: rect.top - 6 });
  };

  const extractHighlightedText = async () => {
    if (!extractTip || !sourceEvidence) return;
    const caseId = resolvedCaseId ?? await ensureActiveCase();
    if (!caseId) return;
    const quote = extractTip.text;
    await addVerifyDrafts([{
      caseId,
      evidenceId: sourceEvidence.id,
      timestamp: Date.now(),
      timestampLabel: "Unknown",
      entityId: "",
      entityName: "Unassigned",
      suggestNewEntity: true,
      newEntityType: "person",
      category: "evidence",
      title: quote.length > 72 ? `${quote.slice(0, 69)}…` : quote,
      snippet: quote,
      details: "Manual selection from source",
      confidence: 1,
      citation: "selection",
      sourceCitation: {
        sourceId: sourceEvidence.id,
        sourceName: sourceEvidence.fileName,
        sourceType: inferSourceType(sourceEvidence),
        exactQuote: quote,
      },
    }]);
    setExtractTip(null);
    window.getSelection()?.removeAllRanges();
    setScreen("Verify");
  };

  const setHoveredCard = (id: string | null, origin: "card" | "doc") => {
    hoverOriginRef.current = id ? origin : null;
    setActiveHoveredCardId(id);
  };

  const syncQueueToSourceScroll = () => {
    if (queueSyncLock.current || hoverOriginRef.current === "card") return;
    const source = sourcePaneRef.current;
    const queue = queuePaneRef.current;
    if (!source || !queue) return;
    const marks = [...source.querySelectorAll<HTMLElement>("[id^='verify-quote-']")];
    if (!marks.length) return;
    const probeY = source.getBoundingClientRect().top + Math.min(140, source.clientHeight * 0.25);
    let lead: HTMLElement | null = null;
    for (const mark of marks) {
      if (mark.getBoundingClientRect().top <= probeY) lead = mark;
      else break;
    }
    const target = lead ?? marks[0];
    const card = document.getElementById(`verify-card-${target.id.slice("verify-quote-".length)}`);
    if (!card || !queue.contains(card)) return;
    const qBox = queue.getBoundingClientRect();
    const cBox = card.getBoundingClientRect();
    if (cBox.top >= qBox.top + 12 && cBox.bottom <= qBox.bottom - 12) return;
    queueSyncLock.current = true;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => { queueSyncLock.current = false; }, 280);
  };

  useEffect(() => {
    if (screen !== "Verify" || !activeHoveredCardId) return;
    const origin = hoverOriginRef.current;
    const targetId = origin === "doc"
      ? `verify-card-${activeHoveredCardId}`
      : `verify-quote-${activeHoveredCardId}`;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [activeHoveredCardId, screen, sourceEvidence?.id, sourceQuoteSegments.length]);

  /* ---------------------------------------------------------------- */

  return (
    <div className="flex min-h-screen gap-0 bg-slate-200/60 p-3.5 font-sans text-slate-900">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">

        {/* sidebar */}
        <aside className="flex w-[236px] shrink-0 flex-col border-r border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => goTo("Hub")}
            aria-label="INTELLIDEX home"
            className="flex h-16 w-full shrink-0 items-center gap-2.5 border-b border-slate-200 px-5 text-left hover:bg-slate-50"
          >
            <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg bg-blue-600 p-1.5">
              <div className="h-2 w-2 rounded-[2px] bg-white" />
            </div>
            <span className="font-mono text-lg font-bold tracking-wider text-slate-900">INTELLIDEX</span>
          </button>
          <nav className="flex flex-1 flex-col gap-[3px] p-3 pt-4">
            <div className={`px-2.5 pb-2 pt-1.5 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>GLOBAL</div>
            {GLOBAL_NAV.map(({ id, icon: Icon }) => {
              const on = screen === id;
              return (
                <button key={id} type="button" onClick={() => goTo(id)}
                  className={`flex h-[38px] w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors ${on ? "bg-blue-50 font-semibold text-blue-700" : "font-medium text-slate-600 hover:bg-slate-50"}`}>
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  {id}
                </button>
              );
            })}
            <div className={`mt-3 px-2.5 pb-2 pt-1.5 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>CASE WORKSPACE</div>
            {CASE_NAV.map(({ id, icon: Icon, badge }) => {
              const on = screen === id;
              const locked = screen === "Hub" || !activeCase;
              return (
                <div key={id} title={locked ? "Select a case from the Hub to view" : undefined}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => goTo(id)}
                    className={`flex h-[38px] w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors ${locked ? "cursor-not-allowed opacity-40" : on ? "bg-blue-50 font-semibold text-blue-700" : "font-medium text-slate-600 hover:bg-slate-50"}`}
                  >
                    <Icon className="h-[17px] w-[17px] shrink-0" />
                    {id}
                    <div className="flex-1" />
                    {badge != null && (
                      <span className={`rounded-md px-1.5 py-0.5 ${mono} text-[10.5px] font-semibold ${id === "Verify" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                        {badge}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </nav>
          <div className="shrink-0 p-3.5">
            <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-emerald-500" />
                <span className="text-[12.5px] font-semibold">Local vault</span>
              </div>
              <p className="mb-2.5 text-[11.5px] leading-relaxed text-slate-500">Evidence is stored on this machine. Nothing syncs until you export.</p>
              <div className={`${mono} text-[10.5px] text-slate-500`}>1.4 GB / 20 GB</div>
              <div className="mt-1.5 h-1 overflow-hidden rounded bg-slate-200">
                <div className="h-full w-[22%] rounded bg-blue-600" />
              </div>
            </div>
          </div>
        </aside>

        {/* main column */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
          <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6">
            <button
              type="button"
              aria-label="Search cases, entities, evidence"
              onClick={() => setSearchOpen(true)}
              className="flex h-[38px] w-[340px] min-w-[150px] max-w-[45%] shrink items-center gap-2.5 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-left hover:border-slate-300"
            >
              <Search className="h-[15px] w-[15px] shrink-0 text-slate-500" />
              <span className="min-w-0 truncate text-[13px] text-slate-500">Search cases, entities, evidence…</span>
              <div className="flex-1" />
              <span className={`shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 ${mono} text-[10.5px] text-slate-500`}>⌘K</span>
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-2.5">
              {activeCase && (
                <button
                  type="button"
                  disabled={operator.permissions?.canExportDossier === false}
                  onClick={() => { setExportError(null); setExportOpen(true); }}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3 text-xs font-medium tracking-wide text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                >
                  <FileDown className="h-3.5 w-3.5 text-slate-500" />Export Official INTELLIDEX
                </button>
              )}
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/50 bg-emerald-50/80 px-2.5 py-1 font-mono text-[11px] text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />SECURE / LOCAL
              </div>
              <button
                onClick={() => {
                  setApiKeyDraft(getLocalApiKey());
                  setProviderDraft(getLocalProvider());
                  setSettingsOpen(true);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-900"
                aria-label="API settings"
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Creator menu"
                  aria-expanded={operatorMenu}
                  onClick={() => setOperatorMenu((v) => !v)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-[11.5px] font-bold text-blue-700 hover:border-blue-400"
                >
                  {operatorInitials}
                </button>
                {operatorMenu && (
                  <div className="absolute right-0 z-30 mt-2 w-[260px] overflow-hidden rounded-[12px] border border-slate-200 bg-white py-1 shadow-xl">
                    <button type="button" onClick={() => goTo("Profile")}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                      <UserRound className="h-4 w-4 text-slate-400" />Creator Profile
                    </button>
                    <button type="button" onClick={() => goTo("Preferences")}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                      <Settings2 className="h-4 w-4 text-slate-400" />Workspace Preferences
                    </button>
                    <div className="my-1 h-px bg-slate-100" />
                    <button type="button" onClick={() => { setOperatorMenu(false); setResetPrompt(true); }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-rose-700 hover:bg-rose-50">
                      <Lock className="h-4 w-4" />Lock Session / Reset Local DB
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="flex min-w-0 flex-1 flex-col overflow-auto">

            {screen === "Profile" && (
              <ProfileSettings
                profile={operator}
                saving={savingProfile}
                onCancel={() => goTo("Hub")}
                onSave={async (next) => {
                  setSavingProfile(true);
                  try {
                    await saveOperatorProfile(next);
                    applyThemePreference(next.themePreference);
                    setToast("Operator profile saved.");
                  } finally {
                    setSavingProfile(false);
                  }
                }}
              />
            )}

            {screen === "Preferences" && (
              <WorkspacePreferences
                themePreference={operator.themePreference ?? "system"}
                onThemeChange={async (pref) => {
                  await saveOperatorProfile({ ...operator, themePreference: pref });
                }}
                onBack={() => goTo("Hub")}
              />
            )}

            {/* ---------------- HUB ---------------- */}
            {screen === "Hub" && (() => {
              const shownCases = hubTab === "archived" ? archivedHubCases : activeHubCases;
              const waitingCount = activeHubCases.length;
              const archivedCount = archivedHubCases.length;
              return (
              <div className="mx-auto w-full max-w-[1180px] px-10 pb-18 pt-13" onClick={() => setHubCardMenuId(null)}>
                <div className={`mb-5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>CREATOR // {creatorLabel}</div>
                <h1 className="mb-3.5 w-full max-w-none text-[40px] font-semibold leading-tight tracking-tight">
                  {hubTab === "archived"
                    ? (archivedCount === 1 ? "1 archived case" : `${archivedCount} archived cases`)
                    : waitingCount === 1
                      ? "One case is waiting on you."
                      : `${waitingCount} cases are waiting on you.`}
                </h1>
                <p className="mb-8 w-full max-w-4xl text-[15px] leading-relaxed text-slate-500">
                  {hubTab === "archived"
                    ? "Closed investigations stay on this machine. Restore one to bring it back to the active list."
                    : "Open an active investigation, or start a new INTELLIDEX case and bring in evidence. Everything stays on this machine until you export it."}
                </p>
                {hubTab === "active" && (
                  <div className="flex flex-wrap gap-3">
                    <button onClick={openNewCase} className="inline-flex h-10 items-center gap-2.5 rounded-[10px] bg-blue-600 px-[18px] text-[13.5px] font-semibold text-white transition-colors hover:bg-blue-700">
                      <FolderPlus className="h-[15px] w-[15px]" />New case
                    </button>
                  </div>
                )}

                <div className="mb-5 mt-16 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
                  <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHubTab("active"); }}
                      className={`h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${hubTab === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Active Cases
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHubTab("archived"); }}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${hubTab === "archived" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Archived
                      <span className={`rounded-full px-1.5 py-px ${mono} text-[10px] ${hubTab === "archived" ? "bg-slate-200 text-slate-700" : "bg-slate-200/80 text-slate-500"}`}>
                        {archivedCount}
                      </span>
                    </button>
                  </div>
                  <span className={`${mono} text-[11px] text-slate-500`}>{shownCases.length} SHOWN</span>
                </div>

                {hubTab === "active" && hubCases && waitingCount === 0 && (
                  <div className="mb-6 rounded-[14px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-[13px] text-slate-500">
                    No cases in the local vault yet. Create one to get started.
                  </div>
                )}
                {hubTab === "archived" && archivedCount === 0 && (
                  <div className="mb-6 rounded-[14px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-[13px] text-slate-500">
                    No archived cases. Closed investigations will appear here.
                  </div>
                )}

                <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
                  {shownCases.map((c) => {
                    const tone = statusToTone(c.status);
                    const archived = isArchivedCase(c);
                    return (
                    <article
                      key={c.id}
                      onClick={() => { if (!archived) openExistingCase(c.id, c.title, c.summary, c.status); }}
                      className={`relative rounded-[14px] border bg-white p-5 pb-[18px] shadow-sm transition-colors ${archived ? "border-slate-200" : "cursor-pointer border-slate-200 hover:border-slate-300"}`}
                    >
                      <div className="mb-3.5 flex items-start justify-between gap-3">
                        <div>
                          <div className={`mb-[7px] ${mono} text-[10.5px] tracking-[0.1em] text-slate-500`}>{c.id}</div>
                          <h3 className="text-[21px] font-semibold leading-tight tracking-tight">{c.title}</h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {archived ? (
                            <span className={`inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-slate-500`}>ARCHIVED</span>
                          ) : (
                            <Chip tone={tone}>{c.status}</Chip>
                          )}
                          <div className="relative">
                            <button
                              type="button"
                              aria-label="Case actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHubCardMenuId((id) => id === c.id ? null : c.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {hubCardMenuId === c.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 z-20 mt-1 min-w-[168px] overflow-hidden rounded-[10px] border border-slate-200 bg-white py-1 shadow-lg"
                              >
                                {archived ? (
                                  <button
                                    type="button"
                                    onClick={() => void unarchiveCase(c.id, c.title)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                                  >
                                    <ArchiveRestore className="h-3.5 w-3.5" />Unarchive Case
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setArchivePrompt({ id: c.id, title: c.title })}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                                  >
                                    <Archive className="h-3.5 w-3.5" />Archive Case
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="mb-[18px] text-[13px] leading-relaxed text-slate-500 text-pretty">{c.summary || "No summary recorded."}</p>
                      <div className={`mb-3.5 flex items-center gap-4 ${mono} text-[11px] text-slate-500`}>
                        <span className="inline-flex items-center gap-1.5"><Users className="h-[13px] w-[13px]" />{c.entityCount} entities</span>
                        <span className="inline-flex items-center gap-1.5"><FileText className="h-[13px] w-[13px]" />{c.fileCount} files</span>
                        <span className="inline-flex items-center gap-1.5"><Clock className="h-[13px] w-[13px]" />{formatTouched(c.updatedAt)}</span>
                      </div>
                      {archived ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openExistingCase(c.id, c.title, c.summary, c.status); }}
                            className="inline-flex h-8 items-center rounded-[8px] border border-slate-300 px-3 text-[12.5px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void unarchiveCase(c.id, c.title); }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-slate-900 px-3 text-[12.5px] font-semibold text-white hover:bg-slate-800"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />Restore
                          </button>
                        </div>
                      ) : (
                        <div className="h-0.5 overflow-hidden rounded bg-slate-200">
                          <div className={`h-full rounded transition-all ${TONE_BAR[tone]}`} style={{ width: `${c.pct}%` }} />
                        </div>
                      )}
                    </article>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* ---------------- SETUP ---------------- */}
            {CASE_WORKSPACE.includes(screen) && screen !== "Setup" && !activeCase && (
              <NoActiveCase onHub={() => goTo("Hub")} />
            )}
            {screen === "Setup" && (
              <div className="mx-auto w-full max-w-[1180px] px-10 pb-20 pt-12">
                <div className="mb-8">
                  <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>
                    {resolvedCaseId ? `${resolvedCaseId} / ${SETUP_CRUMB[step] ?? "SETUP"}` : "NEW CASE / LOCAL VAULT"}
                  </div>
                  <h1 className="text-[34px] font-semibold leading-tight tracking-tight">Case setup</h1>
                </div>

                <div className="flex flex-col items-stretch gap-5">
                  <input ref={setupFileRef} type="file" accept={EVIDENCE_ACCEPT} multiple className="hidden"
                    onChange={(e) => { if (e.target.files) void ingestFiles(e.target.files); e.target.value = ""; }} />
                  <aside className="flex max-w-full flex-row flex-wrap gap-1.5">
                    {STEPS.map((s, i) => {
                      const active = i === step, done = i < step;
                      return (
                        <button key={s.label} onClick={() => setStep(i)}
                          className={`flex shrink-0 items-center gap-3 whitespace-nowrap rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${active ? "border-blue-200 bg-blue-50 text-slate-900" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                          <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border ${mono} text-[11px] ${active ? "border-blue-600 bg-blue-600 text-white" : done ? "border-blue-300 text-blue-600" : "border-slate-300 text-slate-500"}`}>
                            {done ? "✓" : i + 1}
                          </span>
                          <span className="flex flex-col gap-[3px]">
                            <span className="text-[13.5px] font-medium">{s.label}</span>
                            <span className="text-[11.5px] text-slate-500">{s.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                    <div className={`ml-auto flex items-center gap-2 self-center whitespace-nowrap ${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />STORED IN INDEXEDDB
                    </div>
                  </aside>

                  {step === 0 && (
                    <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 px-[22px] py-[18px]">
                        <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Case details</h2>
                        <p className="text-[12.5px] text-slate-500">This writes a real row to the local database. Refresh and it will still be here.</p>
                      </div>
                      <div className="flex flex-col gap-5 px-[22px] py-[22px]">
                        <div className="flex flex-col gap-2">
                          <label className="text-[12px] font-semibold text-slate-700">Title</label>
                          <input
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            placeholder="e.g. North Quay transfers"
                            className={`${inputCls} h-11 text-[15px] font-semibold`}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[12px] font-semibold text-slate-700">Summary</label>
                          <textarea
                            value={draftSummary}
                            onChange={(e) => setDraftSummary(e.target.value)}
                            placeholder="What this investigation is about"
                            className={`${inputCls} h-[92px] resize-none py-2.5 text-[13.5px] leading-relaxed`}
                          />
                        </div>
                        <div className="flex flex-col gap-2.5">
                          <label className="text-[12px] font-semibold text-slate-700">Status</label>
                          <div className="flex flex-wrap gap-2">
                            {CASE_STATUSES.map((st) => {
                              const on = st === draftStatus;
                              return (
                                <button key={st} type="button" onClick={() => setDraftStatus(st)}
                                  className={`h-[30px] rounded-lg border px-3 ${mono} text-[10.5px] tracking-[0.08em] transition-colors ${on ? "border-blue-400 bg-blue-50 font-semibold text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                                  {st}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            disabled={!draftTitle.trim() || savingCase}
                            onClick={() => void submitNewCase()}
                            className="flex items-start gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3.5 text-left transition-colors hover:border-slate-300 disabled:opacity-40"
                          >
                            <FolderPlus className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                            <span>
                              <span className="mb-0.5 block text-[13.5px] font-semibold text-slate-900">Start from scratch</span>
                              <span className="block text-[12px] leading-snug text-slate-500">Create the case and open it without importing files.</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={!draftTitle.trim() || savingCase}
                            onClick={() => void ensureActiveCase().then((id) => { if (id) setStep(1); })}
                            className="flex items-start gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-40"
                          >
                            <Upload className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                            <span>
                              <span className="mb-0.5 block text-[13.5px] font-semibold text-slate-900">Import existing case</span>
                              <span className="block text-[12px] leading-snug text-slate-500">Upload or paste reports, narratives, and logs next.</span>
                            </span>
                          </button>
                        </div>
                        <div className="flex items-center justify-end gap-2.5 pt-1">
                          <button type="button" onClick={() => setScreen("Hub")}
                            className="h-9 rounded-[10px] border border-slate-300 px-4 text-[13px] text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">
                            Cancel
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {step === 1 && (
                    <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 px-[22px] py-[18px]">
                        <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Sources</h2>
                        <p className="text-[12.5px] text-slate-500">Upload or paste initial reports, narratives, and logs. They stay in IndexedDB for this case.</p>
                      </div>
                      <div className="px-[22px] py-[22px]">
                        <div
                          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
                          onDragLeave={() => setDragging(false)}
                          onDrop={(e) => { e.preventDefault(); setDragging(false); void ingestFiles(e.dataTransfer.files); }}
                          onClick={() => { if (!busy) setupFileRef.current?.click(); }}
                          className={`flex cursor-pointer flex-col items-center justify-center rounded-[10px] border border-dashed px-8 py-10 text-center transition-colors ${dragging ? "border-blue-600 bg-blue-50/60" : "border-slate-300 bg-slate-50"}`}>
                          <CloudUpload className="mb-3 h-5 w-5 text-blue-600" />
                          <div className="mb-1 text-[15px] font-semibold tracking-tight">
                            {pdfProgress ? "Extracting PDF…" : dragging ? "Release to attach" : "Drop a report or click to upload"}
                          </div>
                          <p className={`${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}>TXT · MD · CSV · JSON · PDF · PNG · JPG · WEBP</p>
                          {pdfProgress && (
                            <div className="mt-3 flex items-center justify-center gap-2 text-[12.5px] text-blue-700">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />{pdfProgress}
                            </div>
                          )}
                        </div>

                        <div className="mt-4">
                          <label className="mb-2 block text-[12px] font-semibold text-slate-700">Or paste a narrative</label>
                          <textarea
                            value={setupPaste}
                            onChange={(e) => setSetupPaste(e.target.value)}
                            rows={4}
                            placeholder="Paste a police narrative, interview notes, or field log…"
                            className={`${inputCls} resize-y py-2.5 text-[13px] leading-relaxed`}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              disabled={!setupPaste.trim()}
                              onClick={() => {
                                void ingestText({ fileName: "setup-notes.txt", fileType: "txt", rawText: setupPaste, fileSize: new Blob([setupPaste]).size });
                                setSetupPaste("");
                              }}
                              className="h-8 rounded-[10px] bg-blue-600 px-3.5 text-[12.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                            >
                              Save notes
                            </button>
                          </div>
                        </div>

                        {extractError && (
                          <div className="mt-3 flex items-start gap-2 text-[12.5px] text-amber-700">
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />{extractError}
                          </div>
                        )}

                        <div className="mt-4 divide-y divide-slate-100">
                          {caseEvidence.map((q) => (
                            <div key={q.id} className="flex items-center gap-3 py-3">
                              {evidenceImageSrc(q) ? (
                                <EvidenceThumb src={evidenceImageSrc(q)} alt={q.fileName} className="h-10 w-10" />
                              ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500">
                                <FileText className="h-3.5 w-3.5" />
                              </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className={`truncate ${mono} text-[12.5px]`}>{q.fileName}</div>
                                <div className="truncate text-[11.5px] text-slate-500">
                                  {evidenceMeta(q)}{q.rawText ? ` · ${q.rawText.slice(0, 60)}` : q.status === "flagged" ? " · No selectable text" : ""}
                                </div>
                              </div>
                              <Chip tone={q.status === "indexed" ? "ok" : q.status === "failed" ? "fail" : q.status === "flagged" ? "review" : "active"}>
                                {q.status === "failed" ? "FAILED" : q.status.toUpperCase()}
                              </Chip>
                              <button type="button" onClick={(e) => { e.stopPropagation(); void deleteEvidence(q.id); }} className="text-slate-400 hover:text-slate-700">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                          {caseEvidence.length === 0 && (
                            <p className="py-4 text-center text-[13px] text-slate-500">No sources yet — you can skip and add entities by hand.</p>
                          )}
                        </div>

                        <div className="mt-5 flex items-center justify-between gap-4">
                          <span className={`${mono} text-[11px] text-slate-500`}>{caseEvidence.length} FILES ATTACHED</span>
                          <div className="flex gap-2.5">
                            <button onClick={() => setStep(0)} className="h-9 rounded-[10px] border border-slate-300 px-4 text-[13px] text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">Back</button>
                            <button onClick={() => setupFileRef.current?.click()}
                              className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-slate-300 px-3.5 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
                              <Upload className="h-3.5 w-3.5" />Upload file
                            </button>
                            <button
                              onClick={() => void continueToEntities()}
                              disabled={busy || scoutingEntities}
                              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                            >
                              {scoutingEntities ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Scouting identities…</>
                              ) : caseEvidence.length === 0 ? (
                                <>Skip to entities<ArrowRight className="h-3.5 w-3.5" /></>
                              ) : (
                                <>Continue to Entities<ArrowRight className="h-3.5 w-3.5" /></>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {step === 2 && (
                  <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-[22px] py-[18px]">
                      <div>
                        <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Entities</h2>
                        <p className="text-[12.5px] text-slate-500">Suggested from sources, plus anyone you add by hand.</p>
                      </div>
                      <button onClick={() => openForm(tab, null)}
                        className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] bg-blue-600 px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-blue-700">
                        <Plus className="h-3.5 w-3.5" />Add custom entity
                      </button>
                    </div>

                    {suggestedIdentities.length > 0 && (
                      <div className="border-b border-slate-200 bg-slate-50/70 px-[22px] py-4">
                        <div className={`mb-3 ${mono} text-[10.5px] tracking-[0.14em] text-slate-500`}>SUGGESTED FROM SOURCES</div>
                        <div className="flex flex-col gap-2.5">
                          {suggestedIdentities.map((item) => {
                            const kind = TYPE_KIND[item.type];
                            const Icon = ENTITY_ICON[kind];
                            const cat = item.type === "place" ? "location" : item.type;
                            return (
                              <div key={item.id} className="rounded-[10px] border border-slate-200 bg-white p-3.5">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Icon className={`h-3.5 w-3.5 ${getCategoryColor(cat, "text")}`} />
                                  <span className="text-[14px] font-medium">{item.name}</span>
                                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] ${getCategoryColor(cat, "badge")}`}>
                                    {cat === "location" ? "LOCATION" : cat === "vehicle" ? "VEHICLE" : "PERSON"}
                                  </span>
                                  <span className={`inline-flex max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${roleDisplayClass(scoutRole(item.type, item.role), getCategoryColor(cat, "badge"))}`}>
                                    {formatRoleLabel(scoutRole(item.type, item.role))}
                                  </span>
                                </div>
                                {item.quote && <p className="mb-1.5 text-[12.5px] leading-relaxed text-slate-500">“{item.quote}”</p>}
                                <div className="flex items-center justify-between gap-3">
                                  <span className={`${mono} text-[10.5px] text-slate-400`}>{item.sourceFile || "Source quote"}</span>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setSuggestedIdentities((rows) => rows.filter((r) => r.id !== item.id))}
                                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-[12px] text-slate-500 hover:text-slate-800">
                                      <X className="h-3 w-3" />Dismiss
                                    </button>
                                    <button type="button" onClick={() => void acceptSuggested(item)}
                                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-600/5 px-2.5 text-[12px] font-medium text-blue-700 hover:bg-blue-600/15">
                                      <Check className="h-3 w-3" />Accept
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-[22px] pt-3">
                      {(Object.keys(SCHEMA) as EntityKind[]).map((name) => {
                        const active = name === tab;
                        const Icon = TAB_ICON[name];
                        return (
                          <button key={name} onClick={() => setTab(name)}
                            className={`inline-flex h-[38px] items-center gap-2 border-b-2 px-3.5 text-[13px] transition-colors ${active ? "border-blue-600 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                            <Icon className="h-3.5 w-3.5" />
                            {name}
                            <span className={`rounded-md bg-slate-100 px-1.5 py-px ${mono} text-[10.5px] ${active ? "text-blue-600" : "text-slate-500"}`}>
                              {caseEntities.filter((e) => e.type === KIND_TYPE[name]).length}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="px-[22px] pb-[22px] pt-2">
                      {list.length === 0 && (
                        <div className="rounded-[10px] border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] text-slate-500">
                          {suggestedIdentities.length
                            ? `Accept suggestions above, or add a custom ${SCHEMA[tab].noun}.`
                            : `No ${tab.toLowerCase()} yet. Skip sources or add a custom ${SCHEMA[tab].noun}.`}
                        </div>
                      )}
                      {list.map((e) => {
                        const Icon = ENTITY_ICON[TYPE_KIND[e.type]];
                        return (
                          <div key={e.id} onClick={() => openForm(tab, e)}
                            className="-mx-2.5 grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[10px] border-b border-slate-100 px-2.5 py-[15px] transition-colors hover:bg-slate-50">
                            <div className={`flex h-9 w-9 items-center justify-center rounded-[10px] border ${getCategoryColor({ entityType: e.type, role: e.role, name: e.name }, "badge")}`}>
                              <Icon className={`h-4 w-4 ${getCategoryColor({ entityType: e.type }, "text")}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="mb-1 flex min-w-0 items-center gap-2.5">
                                <span className="min-w-0 truncate text-[14px] font-medium">{e.name}</span>
                                <span className={`inline-flex max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${roleDisplayClass(e.role, getCategoryColor({ entityType: e.type, role: e.role, name: e.name, text: e.notes }, "badge"))}`}>{formatRoleLabel(e.role)}</span>
                              </div>
                              <div className={`truncate ${mono} text-[11.5px] text-slate-500`}>
                                {e.notes || "No details recorded"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2.5 text-slate-400">
                              <Link2 className="h-[15px] w-[15px] cursor-pointer hover:text-slate-600" />
                              <Pencil className="h-[15px] w-[15px] cursor-pointer hover:text-slate-600" />
                              <MoreHorizontal className="h-[15px] w-[15px] cursor-pointer hover:text-slate-600" />
                            </div>
                          </div>
                        );
                      })}

                      {caseEvidence.length > 0 && (
                        <div className="mt-4 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                          <div className={`mb-2 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>ATTACHED FILES</div>
                          <div className="flex flex-col gap-1.5">
                            {caseEvidence.slice(0, 4).map((q) => (
                              <div key={q.id} className="flex items-center gap-2 text-[12.5px] text-slate-600">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="min-w-0 truncate">{q.fileName}</span>
                              </div>
                            ))}
                            {caseEvidence.length > 4 && (
                              <span className={`${mono} text-[10px] text-slate-400`}>+{caseEvidence.length - 4} MORE</span>
                            )}
                          </div>
                        </div>
                      )}

                      {extractError && step === 2 && (
                        <div className="mt-3 flex items-start gap-2 text-[12.5px] text-amber-700">
                          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />{extractError}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-4 pt-5">
                        <span className={`${mono} text-[11px] text-slate-500`}>
                          {caseEntities.length} ON CASE · {suggestedIdentities.length} SUGGESTED
                        </span>
                        <div className="flex gap-2.5">
                          <button onClick={() => setStep(1)} className="h-9 rounded-[10px] border border-slate-300 px-4 text-[13px] text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">Back</button>
                          <button onClick={() => setStep(3)}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700">
                            Continue to review<ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                  )}

                  {step === 3 && (
                    <section className="overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
                      <div className="border-b border-slate-200 px-[22px] py-[18px]">
                        <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Review & confirm</h2>
                        <p className="text-[12.5px] text-slate-500">Summary before this case opens on Overview.</p>
                      </div>
                      <div className="flex flex-col gap-4 px-[22px] py-[22px]">
                        <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-4">
                          <div className={`mb-2 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>NEW CASE</div>
                          <div className="mb-1 text-[18px] font-semibold tracking-tight">{draftTitle.trim() || "Untitled case"}</div>
                          <p className="mb-3 text-[13px] leading-relaxed text-slate-500">{draftSummary.trim() || "No summary recorded."}</p>
                          <Chip tone={statusToTone(draftStatus)}>{draftStatus}</Chip>
                          <div className={`mt-3 ${mono} text-[11px] text-slate-500`}>
                            {caseEvidence.length} SOURCES · {caseEntities.length} ENTITIES
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2.5">
                          <button onClick={() => setStep(2)} className="h-9 rounded-[10px] border border-slate-300 px-4 text-[13px] text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">Back</button>
                          <button type="button" onClick={() => void submitNewCase()} disabled={!draftTitle.trim() || savingCase}
                            className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40">
                            {savingCase ? "Saving…" : "Confirm and open case"}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- OVERVIEW ---------------- */}
            {screen === "Overview" && activeCase && (
              <CaseOverview
                activeCase={activeCase}
                entities={caseEntities}
                evidence={caseEvidence}
                events={caseEvents}
                pendingCount={pendingDrafts.length}
                conflictCount={chrono.tether?.count ?? 0}
                onAddEvidence={() => setScreen("Intake")}
                onOpenTimeline={() => setScreen("Timeline")}
                onInspectContradiction={() => inspectContradiction()}
                onOpenEntity={(ent) => {
                  setSelected(ent.id);
                  setTab(TYPE_KIND[ent.type]);
                  openForm(TYPE_KIND[ent.type], ent);
                }}
                onDropFiles={(files) => ingestFiles(files, { extract: false })}
                onExportDossier={() => { setExportError(null); setExportOpen(true); }}
                canExport={operator.permissions?.canExportDossier !== false}
                onArchiveCase={async () => {
                  if (!activeCase) return;
                  await setCaseArchived(activeCase.id, true);
                  setToast(`${activeCase.title} moved to archive.`);
                  setActiveCaseId("");
                  setHubTab("archived");
                  goTo("Hub");
                }}
                onUnarchiveCase={() => {
                  if (!activeCase) return;
                  void unarchiveCase(activeCase.id, activeCase.title);
                }}
              />
            )}

            {/* ---------------- INTAKE ---------------- */}
            {screen === "Intake" && activeCase && (
              <EvidenceIntake
                activeCase={activeCase}
                caseEvidence={caseEvidence}
                extractError={extractError}
                ingestJob={ingestJob}
                nowMs={nowMs}
                busy={busy}
                dragging={dragging}
                setDragging={setDragging}
                pasteText={pasteText}
                setPasteText={setPasteText}
                sampleNarrative={SAMPLE_NARRATIVE}
                fileRef={fileRef}
                activeEvidenceId={activeEvidenceId}
                setActiveEvidenceId={setActiveEvidenceId}
                inputCls={inputCls}
                jobElapsed={jobElapsed}
                onDropFiles={(files) => { void ingestFiles(files); }}
                onPasteSave={() => {
                  const text = pasteText;
                  setPasteText("");
                  void (async () => {
                    let rowId: string | null = null;
                    let extractStarted = false;
                    try {
                      const row = await withStageTimeout(ingestText({
                        fileName: "pasted-notes.txt",
                        fileType: "txt",
                        rawText: text,
                        fileSize: new Blob([text]).size,
                      })) as { id: string } | null;
                      if (!row) return;
                      rowId = row.id;
                      extractStarted = true;
                      await runExtract(row.id);
                    } catch (err) {
                      const message = stagingFailureMessage(err);
                      if (rowId) await clearIngestingAsFailed(rowId, err);
                      setExtractError(message);
                      window.alert(message);
                    } finally {
                      if (rowId && !extractStarted) {
                        const rec = await db.evidence.get(rowId);
                        if (rec?.status === "ingesting") {
                          await db.evidence.update(rowId, { status: "failed", lastError: STAGE_SIZE_ERROR });
                        }
                      }
                    }
                  })();
                }}
                onExtract={(id) => { void runExtract(id); }}
                onRetry={(id) => { void runExtract(id, { maxPages: CLAUDE_RETRY_PAGES, maxChars: CLAUDE_MAX_CHARS }); }}
                onRetrySummary={(id) => { void runExtract(id, { maxPages: CLAUDE_RETRY_PAGES, maxChars: 8_000, summary: true }); }}
                onSkipVerify={() => setScreen("Verify")}
                onImportUrl={async (url, onProgress) => {
                  try {
                    await ingestWebArticle(url, onProgress);
                  } catch (err) {
                    const message = err instanceof Error ? err.message : "Could not import that article.";
                    setExtractError(message);
                    throw err;
                  }
                }}
              />
            )}

            {/* ---------------- VERIFY ---------------- */}
            {screen === "Verify" && activeCase && (
              <div className="grid h-[calc(100vh-94px)] min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-slate-200">
                  <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6">
                    <div className={`flex min-w-0 items-center gap-2.5 truncate ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>
                      <FileText className="h-3.5 w-3.5 shrink-0" />SOURCE / {sourceEvidence?.fileName.toUpperCase() ?? "NO FILE"}
                      {sourceEvidence?.pageCount ? ` · ${sourceEvidence.pageCount} PAGES` : sourceEvidence?.imageBase64 ? " · IMAGE" : ""}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {caseEvidence.length > 1 && (
                        <select value={sourceEvidence?.id ?? ""} onChange={(e) => setActiveEvidenceId(e.target.value)}
                          className={`max-w-[180px] rounded-md border border-slate-200 bg-white px-2 py-1 ${mono} text-[10.5px]`}>
                          {caseEvidence.map((e) => <option key={e.id} value={e.id}>{e.fileName}</option>)}
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={busy || !(sourceEvidence?.fileBase64 || sourceEvidence?.imageBase64 || sourceEvidence?.rawText.trim())}
                        onClick={() => sourceEvidence && void runExtract(sourceEvidence.id)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-600 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40"
                      >
                        <RefreshCw className={`h-3 w-3 ${extracting ? "animate-spin" : ""}`} />
                        Re-run Extraction
                      </button>
                    </div>
                  </div>
                  <div ref={sourcePaneRef} onScroll={syncQueueToSourceScroll} onMouseUp={captureSourceSelection} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    {extractError && (
                      <div className="mx-3 mt-3 flex items-start gap-2.5 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-800">
                        <TriangleAlert className="mt-0.5 h-[15px] w-[15px] shrink-0" />
                        {extractError}
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      <SourceDocumentViewer
                        evidence={sourceEvidence}
                        citation={(() => {
                          const d = narrativeQueue.find((row) => row.id === activeHoveredCardId) ?? narrativeQueue[0];
                          return d ? citationFromDraft(d, caseEvidence.find((e) => e.id === d.evidenceId) ?? sourceEvidence) : null;
                        })()}
                        anchors={narrativeQueue.map((row) => ({
                          id: row.id,
                          citation: citationFromDraft(row, caseEvidence.find((e) => e.id === row.evidenceId) ?? sourceEvidence),
                        }))}
                        activeId={activeHoveredCardId}
                        showClose={false}
                        onSelectAnchor={(id) => {
                          setHoveredCard(id, "doc");
                          document.getElementById(`verify-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      />
                    </div>
                    {extractTip && (
                      <ExtractSelectionTip
                        x={extractTip.x}
                        y={extractTip.y}
                        onExtract={() => void extractHighlightedText()}
                        onDismiss={() => setExtractTip(null)}
                      />
                    )}
                  </div>
                </section>

                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-50/60">
                  <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-6">
                    <div className={`flex min-w-0 items-center gap-2.5 truncate ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>
                      <Inbox className="h-3.5 w-3.5 shrink-0" />AI EXTRACTION QUEUE
                    </div>
                    <span className={`shrink-0 whitespace-nowrap ${mono} text-[11px] text-slate-500`}>
                      {pendingDrafts.length} UNRESOLVED
                    </span>
                  </div>

                  <div ref={queuePaneRef} className="flex flex-1 flex-col gap-3 overflow-auto px-6 pb-6 pt-5">
                    {narrativeQueue.map((d) => (
                      <VerifyQueueCard
                        key={d.id}
                        draft={d}
                        evidence={caseEvidence.find((e) => e.id === d.evidenceId)}
                        entity={caseEntities.find((e) => e.id === d.entityId)}
                        active={activeHoveredCardId === d.id}
                        editing={editingDraftId === d.id}
                        inputCls={inputCls}
                        categories={VERIFY_CATEGORIES}
                        entities={caseEntities}
                        parseEventTime={parseEventTime}
                        onHoverStart={() => {
                          if (d.evidenceId && d.evidenceId !== sourceEvidence?.id) setActiveEvidenceId(d.evidenceId);
                          setHoveredCard(d.id, "card");
                        }}
                        onHoverEnd={() => setHoveredCard(null, "card")}
                        onOpenCitation={(citation) => {
                          if (d.evidenceId) setActiveEvidenceId(d.evidenceId);
                          setHoveredCard(d.id, "card");
                          void citation;
                        }}
                        onConfirm={() => void confirmVerifyDraft(d.id)}
                        onReject={() => void rejectVerifyDraft(d.id)}
                        onEdit={() => setEditingDraftId(d.id)}
                        onDoneEdit={() => setEditingDraftId(null)}
                        onPatch={(patch) => void updateVerifyDraft(d.id, patch as Parameters<typeof updateVerifyDraft>[1])}
                      />
                    ))}

                    {pendingDrafts.length === 0 && (
                      <div className="flex flex-col items-center gap-2.5 rounded-[14px] border border-dashed border-slate-300 px-5 py-14 text-center">
                        <CheckCheck className="h-[18px] w-[18px] text-blue-600" />
                        <div className="text-[20px] font-semibold">
                          {extractError || (sourceEvidence && isUnreadableScan(sourceEvidence.rawText))
                            ? "Extraction blocked"
                            : caseEvidence.length ? "Queue cleared" : "Nothing to verify"}
                        </div>
                        <p className="max-w-[34ch] text-[12.5px] text-slate-500 text-pretty">
                          {extractError
                            ? extractError
                            : sourceEvidence && isUnreadableScan(sourceEvidence.rawText)
                            ? UNREADABLE_SCAN_ALERT
                            : sourceEvidence?.textClarity === "low"
                            ? SCAN_NOTE
                            : caseEvidence.length
                            ? "Confirmed events are on the chronology. Rejected cards stay dismissed. Highlight source text to extract a card, or Re-run Extraction."
                            : "Ingest a narrative on Intake, then run Extract with AI."}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-6">
                    <span className={`${mono} text-[11px] text-slate-500`}>CONFIRM WRITES TO TIMELINEEVENTS</span>
                    <button onClick={() => setScreen("Timeline")}
                      className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-slate-300 px-[15px] text-[12.5px] font-medium text-slate-600 transition-colors hover:border-blue-600 hover:text-blue-600">
                      Open chronology<ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </section>
              </div>
            )}

            {screen === "Graph" && activeCase && (
              <EntityGraph
                entities={caseEntities}
                relationships={caseRelationships}
              />
            )}

            {/* ---------------- TIMELINE ---------------- */}
            {screen === "Timeline" && activeCase && (
              <div className="flex h-[calc(100vh-94px)]">
                <EntityDossier
                  open={sidebarOpen}
                  selected={selected}
                  lanes={chrono.lanes}
                  onToggle={() => setSidebarOpen((v) => !v)}
                  onSelect={setSelected}
                  ToggleIcon={sidebarOpen ? PanelLeftClose : PanelLeftOpen}
                />

                <div className="flex min-w-0 flex-1 flex-col">
                  {chrono.tether ? (
                    <div className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                      <TriangleAlert className="h-[15px] w-[15px] shrink-0 text-amber-700" />
                      <span className="min-w-0 text-[13px] text-amber-900 text-pretty">
                        <span className="font-semibold text-amber-700">{chrono.tether.count} contradiction{chrono.tether.count === 1 ? "" : "s"} detected</span>
                        {" — "}{chrono.tether.detail}
                      </span>
                      <div className="min-w-[8px] flex-1" />
                      <button type="button" onClick={() => inspectContradiction()}
                        className="h-7 shrink-0 whitespace-nowrap rounded-lg border border-amber-300 px-3 text-[12px] text-amber-700 transition-colors hover:bg-amber-100">
                        Inspect
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
                      <span className={`min-w-0 truncate ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>
                        {activeCase ? `${activeCase.id} / ${activeCase.title.toUpperCase()}` : "NO CASE SELECTED"}
                      </span>
                    </div>
                  )}

                  <div className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-5 py-2">
                    <select
                      value={resolvedCaseId ?? ""}
                      onChange={(e) => setActiveCaseId(e.target.value || null)}
                      className={`h-7 max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 ${mono} text-[11px] text-slate-600 outline-none`}
                    >
                      {(hubCases ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{isArchivedCase(c) ? `[ARCHIVED] ${c.title}` : c.title}</option>
                      ))}
                    </select>
                    <span className="h-4 w-px shrink-0 bg-slate-200" />
                    <TimelineToolbar
                      rangeLabel={chrono.rangeLabel}
                      dayLabel={chrono.dayLabel}
                      timeLabel={chrono.timeLabel}
                      dayKeys={chrono.dayKeys}
                      dayCounts={chrono.dayCounts}
                      viewAllDates={viewAllDates}
                      activeDay={chrono.activeDay}
                      timeWindow={timeWindow}
                      customStart={customStart}
                      customEnd={customEnd}
                      tickPreset={tickPreset}
                      dateMenu={dateMenu}
                      timeMenu={timeMenu}
                      onToggleDateMenu={() => { setDateMenu((v) => !v); setTimeMenu(false); }}
                      onToggleTimeMenu={() => { setTimeMenu((v) => !v); setDateMenu(false); }}
                      onSelectDay={(day) => {
                        if (day === "all") {
                          setViewAllDates(true);
                        } else {
                          setViewAllDates(false);
                          setViewDay(day);
                        }
                        setViewportFit(true);
                        setDateMenu(false);
                      }}
                      onSelectWindow={(w) => {
                        setTimeWindow(w);
                        setViewportFit(w === "full");
                        setTimeMenu(w === "custom");
                      }}
                      onCustomStart={(v) => { setCustomStart(v); setViewportFit(false); }}
                      onCustomEnd={(v) => { setCustomEnd(v); setViewportFit(false); }}
                      onFit={fitToEvents}
                      onZoomIn={() => { setViewportFit(false); setPxPerHour((p) => Math.min(280, Math.round(p * 1.25))); }}
                      onZoomOut={() => { setViewportFit(false); setPxPerHour((p) => Math.max(18, Math.round(p / 1.25))); }}
                      onTickPreset={(p) => {
                        setTickPreset(p);
                        setPxPerHour(pxForPreset(p));
                        setViewportFit(false);
                      }}
                    />
                    <span className="h-4 w-px shrink-0 bg-slate-200" />
                    <button
                      type="button"
                      onClick={() => chrono.tether && inspectContradiction()}
                      className={`shrink-0 whitespace-nowrap ${mono} text-[11px] ${chrono.tether ? "text-amber-700 hover:underline" : "text-slate-500"}`}
                    >
                      {chrono.all.length} EVENTS · {chrono.lanes.length} LANES{chrono.tether ? ` · ${chrono.tether.count} CONTRADICTION${chrono.tether.count === 1 ? "" : "S"}` : ""}
                    </button>
                    <div className="min-w-0 flex-1" />
                    <button
                      onClick={openAddEvent}
                      disabled={!resolvedCaseId || caseEntities.length === 0}
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />Add Event
                    </button>
                  </div>

                  <div ref={timelineContainerRef} className="flex-1 overflow-auto">
                    {chrono.lanes.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                        <div className="text-[18px] font-semibold">No events plotted</div>
                        <p className="max-w-[40ch] text-[13px] text-slate-500">
                          {caseEntities.length === 0
                            ? "Add a person, place, or vehicle in Case setup first."
                            : "Use Add Event to insert a row into IndexedDB. It will appear on that entity’s swimlane."}
                        </p>
                      </div>
                    ) : (
                    <div className="relative min-h-full pb-15" style={{ width: chrono.width }}>
                      <div className="pointer-events-none absolute inset-y-0 right-0"
                        style={{ left: LANE_PAD, backgroundImage: `repeating-linear-gradient(to right, #f1f5f9 0 1px, transparent 1px ${chrono.pxPerHour * (chrono.tickMs / HOUR_MS)}px)` }} />

                      <div className="relative h-[34px] border-b border-slate-200">
                        {chrono.ticks.map((ts) => {
                          const d = new Date(ts);
                          const label = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
                          return (
                            <div key={ts} className={`absolute top-2.5 -translate-x-1/2 ${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}
                              style={{ left: chrono.xOf(ts) }}>
                              {label}
                            </div>
                          );
                        })}
                      </div>

                      {chrono.lanes.map(({ def, height, placed, tracks, count }) => {
                        const dim = selected != null && selected !== def.id;
                        const KindIcon = ENTITY_ICON[TYPE_KIND[def.type]] ?? Clock;
                        return (
                          <div key={def.id} className={`relative overflow-visible border-b border-slate-200 transition-opacity ${dim ? "opacity-40" : "opacity-100"}`} style={{ height }}>
                            <div className={`sticky left-0 z-[3] flex h-full flex-col justify-center gap-1 border-r border-slate-200 bg-slate-50 pl-5 pr-3.5 ${mono} text-[11px] uppercase leading-snug tracking-[0.06em] text-slate-600`}
                              style={{ width: LANE_PAD }}
                              title={`${def.name} · ${formatRoleLabel(def.role) || def.type}`}
                            >
                              <span className="flex items-center gap-2.5">
                                <span className={`h-[7px] w-[7px] shrink-0 rounded-[2px] ${def.dot}`} />
                                <span className="min-w-0 truncate">{def.name} · {count} {count === 1 ? "event" : "events"}</span>
                              </span>
                              {tracks > 1 && (
                                <span className="pl-[18px] text-[9.5px] font-normal tracking-[0.08em] text-slate-400">
                                  {tracks} TRACKS
                                </span>
                              )}
                            </div>
                            {placed.map(({ e, row, left }) => {
                              const focused = conflictPulse > 0 && chrono.tether && (e.id === chrono.tether.aId || e.id === chrono.tether.bId);
                              return (
                              <button
                                type="button"
                                key={e.id}
                                id={`timeline-node-${e.id}`}
                                title={`${e.title} · ${formatRoleLabel(def.role) || def.name}`}
                                onClick={() => openEventDrawer(e.id)}
                                className={`absolute z-[2] flex items-center gap-2 overflow-hidden rounded-[10px] border border-l-2 bg-white px-2.5 text-left shadow-sm transition-colors hover:border-blue-300 ${e.flag ? "border-amber-300 border-l-amber-600 ring-[3px] ring-amber-500/10" : `border-slate-200 ${getCategoryColor(e.semantic, "border")}`} ${drawerEventId === e.id ? "ring-[3px] ring-blue-600/15" : ""} ${focused ? "contradiction-pulse z-[8] ring-2 ring-amber-500" : ""}`}
                                style={{ left, top: 10 + row * (CARD_H + CARD_GAP), width: CARD_W, height: CARD_H }}
                              >
                                <KindIcon className={`h-3.5 w-3.5 shrink-0 ${e.flag ? "text-amber-700" : getCategoryColor(e.semantic, "text")}`} />
                                <span
                                  role="button"
                                  title="Open source citation"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    const rec = caseEvents.find((row) => row.id === e.id);
                                    const src = rec ? caseEvidence.find((x) => x.id === rec.sourceDocId) : undefined;
                                    if (!rec) return;
                                    setTimelineInspect({ eventId: rec.id, citation: citationFromEvent(rec, src) });
                                  }}
                                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-700 hover:bg-amber-50"
                                >
                                  <FileText className="h-3 w-3" />
                                </span>
                                <span className={`shrink-0 rounded-md border px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.06em] ${e.flag ? "bg-amber-500/10 text-amber-700 border-amber-500/30" : getCategoryColor(e.semantic, "badge")}`}>
                                  {e.time}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-none text-slate-900">{e.title}</span>
                                {e.flag && <TriangleAlert className="h-3 w-3 shrink-0 text-amber-700" />}
                              </button>
                              );
                            })}
                          </div>
                        );
                      })}

                      {chrono.tether && (
                        <div className={`pointer-events-none absolute inset-y-0 left-0 z-[5] ${conflictPulse > 0 ? "contradiction-bridge-pulse" : ""}`} style={{ width: chrono.width }}>
                          <div className="absolute border-l-[1.5px] border-dashed border-amber-600"
                            style={{ left: chrono.tether.A.x, top: chrono.tether.A.bottom, height: chrono.tether.midY - chrono.tether.A.bottom }} />
                          <div className="absolute border-t-[1.5px] border-dashed border-amber-600"
                            style={{ left: Math.min(chrono.tether.A.x, chrono.tether.B.x), top: chrono.tether.midY, width: Math.abs(chrono.tether.B.x - chrono.tether.A.x) }} />
                          <div className="absolute border-l-[1.5px] border-dashed border-amber-600"
                            style={{ left: chrono.tether.B.x, top: chrono.tether.midY, height: chrono.tether.B.top - chrono.tether.midY }} />
                          <div className="absolute h-1.5 w-1.5 rounded-full bg-amber-600" style={{ left: chrono.tether.A.x - 3, top: chrono.tether.A.bottom - 3 }} />
                          <div className="absolute h-1.5 w-1.5 rounded-full bg-amber-600" style={{ left: chrono.tether.B.x - 3, top: chrono.tether.B.top - 3 }} />

                          <button type="button" onClick={() => inspectContradiction(chrono.tether?.id)}
                            className={`pointer-events-auto absolute z-[6] inline-flex h-[26px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-amber-400 bg-amber-50 px-3 ${mono} text-[10.5px] tracking-[0.04em] text-amber-700`}
                            style={{ left: chrono.tether.midX, top: chrono.tether.midY }}>
                            <TriangleAlert className="h-3.5 w-3.5" />{chrono.tether.label}
                          </button>

                          {popover && (
                            <div className="pointer-events-auto absolute z-[7] w-80 -translate-x-1/2 rounded-[14px] border border-amber-200 bg-white p-4 shadow-xl"
                              style={{ left: popoverAnchor?.left ?? chrono.tether.midX, top: popoverAnchor?.top ?? chrono.tether.midY + 22 }}>
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <div className={`mb-1.5 ${mono} text-[10.5px] tracking-[0.1em] text-amber-700`}>CONTRADICTION {chrono.tether.id.slice(0, 8).toUpperCase()}</div>
                                  <div className="text-[19px] font-semibold leading-tight">{chrono.tether.label}</div>
                                </div>
                                <button type="button" onClick={() => setPopover(false)} className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-slate-500 hover:text-slate-900">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <p className="mb-3.5 text-[12.5px] leading-relaxed text-slate-600 text-pretty">
                                {chrono.tether.detail}
                              </p>
                              <div className="mb-3.5 flex flex-col gap-2 rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                                {(() => {
                                  const nodeA = chrono.all.find((e) => e.id === chrono.tether?.aId);
                                  const nodeB = chrono.all.find((e) => e.id === chrono.tether?.bId);
                                  return [
                                    ["NODE A", nodeA ? `${nodeA.time} ${nodeA.title}` : "—"],
                                    ["NODE B", nodeB ? `${nodeB.time} ${nodeB.title}` : "—"],
                                    ["DISTANCE", "42 mi"],
                                    ["OBSERVED GAP", "41 min"],
                                    ["MIN DRIVE TIME", "58 min"],
                                  ];
                                })().map(([k, v]) => (
                                  <div key={k} className={`flex items-center justify-between gap-3 ${mono} text-[11px]`}>
                                    <span className="text-slate-500">{k}</span>
                                    <span className="text-right text-slate-900">{v}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <button type="button" className="h-8 flex-1 rounded-lg border border-amber-300 bg-amber-500/10 text-[12.5px] font-medium text-amber-700">Flag for review</button>
                                <button type="button" className="h-8 flex-1 rounded-lg border border-slate-300 text-[12.5px] text-slate-600">Dismiss</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {timelineInspect && (
        <div className="fixed inset-0 z-[80] flex bg-slate-900/40">
          <button type="button" className="min-w-0 flex-1" aria-label="Close source inspector" onClick={() => setTimelineInspect(null)} />
          <div className="flex h-full w-[min(640px,52vw)] flex-col border-l border-slate-200 bg-white shadow-2xl">
            <SourceDocumentViewer
              evidence={caseEvidence.find((e) => e.id === timelineInspect.citation.sourceId) ?? null}
              citation={timelineInspect.citation}
              activeId={timelineInspect.eventId}
              onClose={() => setTimelineInspect(null)}
              onSelectAnchor={() => {
                const node = document.getElementById(`timeline-node-${timelineInspect.eventId}`);
                node?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            />
          </div>
        </div>
      )}

      {/* ---------------- event detail drawer ---------------- */}
      {drawerEvent && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/30 backdrop-blur-[2px]">
          <div className="flex-1" onClick={() => { setDrawerEventId(null); setDrawerEdit(false); }} />
          <div className="flex h-full w-[440px] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-start gap-3.5 border-b border-slate-200 px-6 pb-[18px] pt-[22px]">
              <div className="min-w-0 flex-1">
                <div className={`mb-1.5 ${mono} text-[10.5px] tracking-[0.12em] text-slate-500`}>TIMELINE EVENT</div>
                {drawerEdit ? (
                  <input value={drawerTitle} onChange={(e) => setDrawerTitle(e.target.value)} className={`${inputCls} h-10 text-[16px] font-semibold`} />
                ) : (
                  <h2 className="text-[18px] font-bold tracking-tight">{drawerEvent.title}</h2>
                )}
                <p className="mt-1 text-[13px] text-slate-500">{drawerEntity?.name ?? "Unknown entity"}</p>
              </div>
              <button
                onClick={() => { setDrawerEventId(null); setDrawerEdit(false); }}
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-5 overflow-auto px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={drawerEvent.isVerified ? "ok" : "review"}>{drawerEvent.isVerified ? "VERIFIED" : "UNVERIFIED"}</Chip>
                {drawerEntity && (
                  <span className={`inline-flex max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${roleDisplayClass(drawerEntity.role, getCategoryColor({ entityType: drawerEntity.type, role: drawerEntity.role, name: drawerEntity.name }, "badge"))}`}>
                    {formatRoleLabel(drawerEntity.role) || drawerEntity.type.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Date</label>
                <input
                  type="date"
                  value={splitLocalDateTime(drawerEvent.timestamp).date}
                  onChange={(e) => void persistDrawerStamp(e.target.value, splitLocalDateTime(drawerEvent.timestamp).time)}
                  className={`${inputCls} h-10 text-[13.5px]`}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Time</label>
                <input
                  type="time"
                  value={splitLocalDateTime(drawerEvent.timestamp).time}
                  onChange={(e) => void persistDrawerStamp(splitLocalDateTime(drawerEvent.timestamp).date, e.target.value)}
                  className={`${inputCls} h-10 text-[13.5px]`}
                />
              </div>
              {drawerEdit ? (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-[12px] font-semibold text-slate-700">Entity</label>
                    <select value={drawerEntityId} onChange={(e) => setDrawerEntityId(e.target.value)} className={`${inputCls} h-10 text-[13.5px]`}>
                      {caseEntities.map((e) => (
                        <option key={e.id} value={e.id}>{e.name} · {e.type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[12px] font-semibold text-slate-700">Observation</label>
                    <textarea value={drawerDesc} onChange={(e) => setDrawerDesc(e.target.value)} className={`${inputCls} min-h-[120px] resize-y py-2.5 text-[13.5px] leading-relaxed`} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className={`mb-1 ${mono} text-[10.5px] tracking-[0.12em] text-slate-500`}>OBSERVATION</div>
                    <p className="text-[13.5px] leading-relaxed text-slate-600 text-pretty">
                      {drawerEvent.description?.trim() ? `“${drawerEvent.description}”` : "No narrative recorded for this event."}
                    </p>
                  </div>
                  <div>
                    <div className={`mb-1 ${mono} text-[10.5px] tracking-[0.12em] text-slate-500`}>SOURCE</div>
                    <div className="text-[13.5px] text-slate-700">
                      <CitationPill
                        citation={citationFromEvent(drawerEvent, drawerSource)}
                        onClick={() => setTimelineInspect({
                          eventId: drawerEvent.id,
                          citation: citationFromEvent(drawerEvent, drawerSource),
                        })}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 px-6 py-4">
              {drawerEdit ? (
                <div className="flex gap-2.5">
                  <button onClick={() => setDrawerEdit(false)} className="h-10 flex-1 rounded-[10px] border border-slate-300 text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
                  <button onClick={() => void saveEventDrawer()} disabled={!drawerTitle.trim() || !drawerWhen || savingDrawer}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] bg-blue-600 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                    <Check className="h-3.5 w-3.5" />{savingDrawer ? "Saving…" : "Save"}
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={() => setDrawerEdit(true)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-slate-300 text-[13px] font-medium text-slate-700 hover:border-slate-400">
                    <Pencil className="h-3.5 w-3.5" />Edit Event
                  </button>
                  <button onClick={() => void deleteEventFromTimeline()}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-red-200 text-[13px] font-medium text-red-700 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" />Delete from Timeline
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} onPick={applySearchHit} />

      {/* ---------------- entity slide-over ---------------- */}
      {form && (
        <EditEntityDrawer
          form={form}
          schema={SCHEMA[form.tab]}
          Icon={ENTITY_ICON[form.tab]}
          inputCls={inputCls}
          onChange={(next) => setForm(next)}
          onSave={() => void saveForm()}
          onCancel={() => setForm(null)}
          onRemove={() => void removeEntity()}
        />
      )}

      {eventOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold tracking-tight">Add event</h2>
                <p className="mt-1 text-[12.5px] text-slate-500">Writes to `timelineEvents` for {activeCase?.title ?? "this case"}.</p>
              </div>
              <button onClick={() => setEventOpen(false)} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                <X className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Entity</label>
                <select value={eventEntityId} onChange={(e) => setEventEntityId(e.target.value)} className={`${inputCls} h-10 text-[13.5px]`}>
                  {caseEntities.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} · {e.type}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-semibold text-slate-700">Date</label>
                  <input
                    type="date"
                    value={eventWhen.slice(0, 10)}
                    onChange={(e) => setEventWhen(`${e.target.value}T${eventWhen.slice(11, 16) || "12:00"}`)}
                    className={`${inputCls} h-10 text-[13.5px]`}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-semibold text-slate-700">Time</label>
                  <input
                    type="time"
                    value={eventWhen.slice(11, 16)}
                    onChange={(e) => setEventWhen(`${eventWhen.slice(0, 10) || localDayKey(Date.now())}T${e.target.value}`)}
                    className={`${inputCls} h-10 text-[13.5px]`}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Title</label>
                <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder="e.g. Seen at Gate 4" className={`${inputCls} h-10 text-[13.5px]`} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Description</label>
                <textarea value={eventDesc} onChange={(e) => setEventDesc(e.target.value)} placeholder="Optional detail" className={`${inputCls} h-[76px] resize-none py-2.5 text-[13.5px] leading-relaxed`} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button onClick={() => setEventOpen(false)} className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={() => void submitEvent()} disabled={!eventEntityId || !eventTitle.trim() || !eventWhen || savingEvent}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-blue-600 px-[18px] text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                <Check className="h-3.5 w-3.5" />{savingEvent ? "Saving…" : "Save event"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetPrompt && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="mb-2 text-[17px] font-bold tracking-tight">Lock session and reset local DB?</h2>
            <p className="mb-5 text-[13.5px] leading-relaxed text-slate-500">
              This deletes every case, source, and operator setting stored in IndexedDB on this machine. It cannot be undone.
            </p>
            <div className="flex justify-end gap-2.5">
              <button type="button" onClick={() => setResetPrompt(false)}
                className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void resetLocalVault().then(() => {
                    window.location.href = "/";
                  });
                }}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700"
              >
                <Lock className="h-3.5 w-3.5" />Reset local vault
              </button>
            </div>
          </div>
        </div>
      )}

      <ArchiveCaseModal
        open={Boolean(archivePrompt)}
        caseTitle={archivePrompt?.title ?? ""}
        onClose={() => setArchivePrompt(null)}
        onConfirm={() => void confirmArchiveCase()}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[90] rounded-[12px] border border-slate-200 bg-white px-4 py-3 text-[13px] font-medium text-slate-800 shadow-lg">
          {toast}
        </div>
      )}

      {exportOpen && activeCase && (
        <ExportDossierModal
          caseId={activeCase.id}
          caseTitle={activeCase.title}
          busy={exportBusy}
          error={exportError}
          onClose={() => { if (!exportBusy) setExportOpen(false); }}
          onGenerate={runOfficialExport}
        />
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold tracking-tight">AI settings</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
                  Prefer <span className={mono}>ANTHROPIC_API_KEY</span> in <span className={mono}>.env.local</span> (server-side). This field is a local fallback and is never synced.
                </p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                <X className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Provider</label>
                <div className="flex gap-2">
                  {(["anthropic", "openai"] as LlmProvider[]).map((p) => (
                    <button key={p} type="button" onClick={() => setProviderDraft(p)}
                      className={`h-9 flex-1 rounded-lg border text-[12.5px] font-medium ${providerDraft === p ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                      {p === "anthropic" ? "Anthropic" : "OpenAI"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">API key</label>
                <input type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder="sk-ant-… or sk-…" className={`${inputCls} h-10 text-[13.5px]`} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button onClick={() => setSettingsOpen(false)} className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600">Cancel</button>
              <button onClick={() => { setLocalApiKey(apiKeyDraft); setLocalProvider(providerDraft); setSettingsOpen(false); }}
                className="h-10 rounded-[10px] bg-blue-600 px-[18px] text-[13px] font-semibold text-white hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
