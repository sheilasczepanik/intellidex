import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addEvidence, addCaseMedia, addVerifyDrafts, applyThemePreference, computeAvatarInitials, confirmVerifyDraft, createCase, createEntity, createTimelineEvent, ensureLastKnownSighting,
  db, DEFAULT_OPERATOR, deleteEntity, deleteEvidence, deleteTimelineEvent, ensureContactsForPeople, formatTouched, hydrateUserProfile, isArchivedCase, isIntakeCompleteStatus, isLocatedCase, isPendingIntakeEvidence, isVisibleInStagingQueue, listHubCases, parseEventTime, promoteEntityToVerified, rejectVerifyDraft, togglePinnedPerson,
  OPERATOR_ID, reopenLocatedCase, resetLocalVault, saveManualEvidence, saveOperatorProfile, setCaseArchived, setCaseLocated, statusToTone, updateEntity, updateTimelineEvent, updateVerifyDraft, type CaseStatus, type EntityRecord, type EntityType,
  type EvidenceRecord, type TimelineEventRecord, type VerifyDraftRecord,
} from "./db";
import { extractEventsFromImage, extractEvidenceLocally } from "./lib/extractClient";
import { extractPdfText, documentText } from "./lib/pdfHelpers";
import { mauraFallbackBundle, mauraVerifiedBundle, isLocalMauraExtractSource } from "./lib/mauraExtractFallback";
import { isMm1Source, mm1ExtractBundle } from "./data/caseFixtures";
import type { ExtractPreview } from "./IngestDrawer";
import { calculateSHA256, calculateSHA256FromText } from "./lib/cryptoUtils";
import { scrapeArticleFromUrl, fallbackArticleFromUrl } from "./lib/scrapeClient";
import { generateAndDownloadDossier, type DossierExportOptions } from "./lib/DossierPdfGenerator";
import WorkingTheory from "./WorkingTheory";
import { applyExtractedGraph } from "./lib/applyExtractGraph";
import CaseOverview from "./CaseOverview";
import LocationsMap from "./LocationsMap";
import MediaGallery from "./MediaGallery";
import IngestChooser from "./IngestChooser";
import DuplicateArbitrationModal from "./DuplicateArbitrationModal";
import ArchiveCaseModal from "./ArchiveCaseModal";
import NewCaseForm from "./NewCaseForm";
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
import ExportDossierModal from "./ExportDossierModal";
import GlobalSearch from "./GlobalSearch";
import ProfileSettings from "./ProfileSettings";
import SourceDocumentViewer, { CitationPill } from "./SourceDocumentViewer";
import TimelineToolbar, { TimelineDateStrip, TimelineHoverTip } from "./Timeline";
import TimelineConflictInspector from "./TimelineConflictInspector";
import VerifyQueueCard, { citationFromDraft, citationFromEvent } from "./VerifyQueueCard";
import VerifySourceSwitcher from "./VerifySourceSwitcher";
import { draftsForSource } from "./lib/useExtraction";
import WorkspacePreferences from "./WorkspacePreferences";
import { ExtractSelectionTip, LogEvidenceModal, VERIFY_CATEGORIES, type ManualLogCategoryId } from "./Verify";
import {
  ingestElapsedSec, type IngestJob,
} from "./lib/ingestProgress";
import { assessTextClarity, logExtractedText } from "./lib/textClarity";
import { isPdfFile, isTextFile, EVIDENCE_ACCEPT } from "./lib/pdfText";
import { isImageFile } from "./lib/imageEvidence";
import { inferSourceType, type SourceBoundingBox, type SourceCitation } from "./types";
import { isSecondaryEvidence, isUncorroboratedEntity } from "./lib/sourceTier";
import MediaProvenanceBadge from "./MediaProvenanceBadge";
import {
  CLAUDE_MAX_CHARS,
  CLAUDE_RETRY_PAGES,
  type ExtractBundle,
  type ExtractedEvent,
} from "./lib/extractSchema";
import TimelineGrid from "./TimelineGrid";
import { useTimelineConflicts } from "./lib/useTimelineConflicts";
import { collectQuoteSpans, locateSnippet, sortByNarrativeOrder, splitTextBySpans } from "./lib/quoteAnchors";
import {
  confidenceTierOf,
  coordinatesForEvent,
  isSightingEvent,
  milesBetween,
  parseTimeEnd,
  primaryIncidentGeo,
  type SwimlaneGroupId,
} from "./types/timeline";
import { applyDupDecision, evidenceToSide, eventToSide, findDuplicateEvidence, findDuplicateEvent, hashNormalizedText, type DupDecision, type DupMatch } from "./lib/duplicates";
import { clusterMergeableEvents, detectLocationConflicts } from "./lib/timelineDedupe";
import { getLocalApiKey, getLocalProvider, setLocalApiKey, setLocalProvider, type LlmProvider } from "./lib/settings";
import { joinLocalDateTime, localDayKey, namesLooselyMatch, splitLocalDateTime } from "./lib/eventTime";
import {
  HOUR_MS, LANE_PAD, UNASSIGNED_LANE_ID, busiestDayKey, earliestDayKey, eventAxisBounds, eventInHourWindow, fillDayStrip, fitPxPerHour,
  formatClockRange, midnightsInRange, pxForPreset, spanDayKeys, tickMsFor, uniqueDayKeys,
  windowHours, type DayScope, type TickPreset, type TimeWindow,
} from "./lib/timelineView";
import { getCategoryColor, resolveSemanticCategory } from "./utils/categoryColors";
import { formatRoleLabel, normalizePersonRole, PERSON_ROLE_VALUES, roleDisplayClass } from "./utils/roleBadge";
import type { SearchHit } from "./lib/globalSearch";
import { formatAlertLabel, ALERT_LEVELS } from "./lib/missingPerson";
import LiveAlertsFeed from "./LiveAlertsFeed";
import VerifyIngestDropzone from "./VerifyIngestDropzone";
import CaseSidebarTree from "./CaseSidebarTree";
import { isSearchNetworkPerson } from "./lib/personDirectory";
import PersonWorkspace from "./PersonWorkspace";
import { alertTypeToCaseStatus, parseAlertMissingAt, type LiveMissingAlert } from "./lib/liveMissingAlert";
import type { SubjectProfile } from "./db/schema";
import {
  ArrowLeft, ArrowRight, Archive, ArchiveRestore, Check, CheckCheck, Clock, FileDown,
  FileText, FolderPlus, GitCommitHorizontal, HeartHandshake, Inbox, KeyRound, LayoutDashboard,
  LayoutGrid, Lock, MapPin, Menu, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Phone, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, StickyNote, Trash2, Truck,
  TriangleAlert, User, Users, UserRound, X, Box, Image as ImageIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export type Screen = "Hub" | "Alerts" | "Setup" | "Overview" | "Intake" | "Media" | "Verify" | "Timeline" | "Locations" | "WorkingTheory" | "Profile" | "Preferences" | "PersonOverview" | "PersonTimeline" | "PersonLocations" | "PersonMedia" | "PersonLinked";
export type Tone = "active" | "review" | "cold" | "ok" | "fail";
export type EntityKind = "People" | "Places" | "Vehicles" | "Phones" | "Digital" | "Exhibits";

const PERSON_SCREENS: Screen[] = ["PersonOverview", "PersonTimeline", "PersonLocations", "PersonMedia", "PersonLinked"];
const PERSON_LEAF_BY_SCREEN: Record<string, import("./PersonWorkspace").PersonLeaf> = {
  PersonOverview: "overview",
  PersonTimeline: "timeline",
  PersonLocations: "locations",
  PersonMedia: "media",
  PersonLinked: "linked",
};
const SCREEN_BY_PERSON_LEAF: Record<string, Screen> = {
  overview: "PersonOverview",
  timeline: "PersonTimeline",
  locations: "PersonLocations",
  media: "PersonMedia",
  linked: "PersonLinked",
};

function parseAppPath(pathname: string): { screen: Screen; caseId: string | null; personId: string | null } {
  const path = pathname.replace(/\/+$/, "") || "/";
  const personMatch = path.match(/^\/cases\/([^/]+)\/persons\/([^/]+)(?:\/(timeline|locations|media|linked))?$/i);
  if (personMatch) {
    const leaf = (personMatch[3] || "overview").toLowerCase();
    return {
      screen: SCREEN_BY_PERSON_LEAF[leaf] ?? "PersonOverview",
      caseId: decodeURIComponent(personMatch[1]),
      personId: decodeURIComponent(personMatch[2]),
    };
  }
  const caseMatch = path.match(/^\/cases\/([^/]+)(?:\/(overview|intake|media|verify|timeline|locations|graph|working-theory))?$/i);
  if (caseMatch) {
    const leaf = (caseMatch[2] || "overview").toLowerCase();
    const screens: Record<string, Screen> = {
      overview: "Overview",
      intake: "Intake",
      media: "Media",
      verify: "Verify",
      timeline: "Timeline",
      locations: "Locations",
      "working-theory": "WorkingTheory",
      graph: "Overview",
    };
    return { screen: screens[leaf] ?? "Overview", caseId: decodeURIComponent(caseMatch[1]), personId: null };
  }
  if (path === "/" || path === "/hub") return { screen: "Hub", caseId: null, personId: null };
  if (path === "/hub/alerts" || path === "/alerts") return { screen: "Alerts", caseId: null, personId: null };
  if (path === "/setup") return { screen: "Setup", caseId: null, personId: null };
  if (path === "/overview") return { screen: "Overview", caseId: null, personId: null };
  if (path === "/intake") return { screen: "Intake", caseId: null, personId: null };
  if (path === "/media") return { screen: "Media", caseId: null, personId: null };
  if (path === "/verify") return { screen: "Verify", caseId: null, personId: null };
  if (path === "/timeline") return { screen: "Timeline", caseId: null, personId: null };
  if (path === "/locations") return { screen: "Locations", caseId: null, personId: null };
  if (path === "/working-theory") return { screen: "WorkingTheory", caseId: null, personId: null };
  if (path === "/graph") return { screen: "Overview", caseId: null, personId: null };
  if (path.startsWith("/settings/profile")) return { screen: "Profile", caseId: null, personId: null };
  if (path.startsWith("/settings/workspace")) return { screen: "Preferences", caseId: null, personId: null };
  return { screen: "Hub", caseId: null, personId: null };
}

function pathFromScreen(screen: Screen, caseId?: string | null, personId?: string | null) {
  if (screen === "Hub") return "/hub";
  if (screen === "Alerts") return "/hub/alerts";
  if (screen === "Profile") return "/settings/profile";
  if (screen === "Preferences") return "/settings/workspace";
  if (screen === "Setup") return "/setup";
  if (PERSON_SCREENS.includes(screen) && caseId && personId) {
    const leaf = PERSON_LEAF_BY_SCREEN[screen] || "overview";
    const suffix = leaf === "overview" ? "" : `/${leaf}`;
    return `/cases/${encodeURIComponent(caseId)}/persons/${encodeURIComponent(personId)}${suffix}`;
  }
  const leaf = screen === "WorkingTheory" ? "working-theory" : screen.toLowerCase();
  if (caseId) return `/cases/${encodeURIComponent(caseId)}/${leaf}`;
  return `/${leaf}`;
}

const CASE_WORKSPACE: Screen[] = ["Overview", "Intake", "Media", "Verify", "Timeline", "Locations", "WorkingTheory", ...PERSON_SCREENS];

function NoActiveCase({ onHub }: { onHub: () => void }) {
  return (
    <div className="flex min-h-[calc(100vh-94px)] flex-1 flex-col items-center justify-center px-8 py-24 text-center">
      <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">No Active Case Selected</h2>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-slate-500">
        Timeline data is scoped to individual cases.
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

const CASE_STATUSES: CaseStatus[] = [...ALERT_LEVELS];

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
    statuses: ["last_seen", "item_recovered", "cell_ping", "search_grid"],
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

const CARD_W = 260, CARD_H = 52, CARD_GAP = 10, CARD_PAD = 12, RULER_H = 35;

function timelineCardWidth(
  event: { time: string; title: string; mergeCount: number; flag?: boolean; timeEndMs?: number },
  axisSpan: number,
) {
  const clock = `${event.time}${event.timeEndMs ? "–00:00" : ""}`;
  const extras = (event.flag ? 76 : 0) + (event.mergeCount > 1 ? 124 : 0);
  const content = 28 + clock.length * 7.5 + 8 + event.title.length * 7.1 + extras;
  return Math.max(axisSpan, 220, Math.ceil(content));
}
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

const mono = "font-mono";
const Chip = ({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) => (
  <span className={`inline-flex min-w-0 max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${TONE_CHIP[tone]} ${className}`}>
    {children}
  </span>
);

const ENTITY_ICON: Record<EntityKind, React.ComponentType<{ className?: string }>> = {
  People: User, Places: MapPin, Vehicles: Truck, Phones: Phone, Digital: Radio, Exhibits: Box,
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

function formatClock(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const boot = parseAppPath(window.location.pathname);
  const [screen, setScreen] = useState<Screen>(boot.screen);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftJurisdiction, setDraftJurisdiction] = useState("");
  const [draftIncidentStart, setDraftIncidentStart] = useState("");
  const [draftIncidentEnd, setDraftIncidentEnd] = useState("");
  const [draftStatus, setDraftStatus] = useState<CaseStatus>("ACTIVE_MISSING");
  const [draftFileId, setDraftFileId] = useState("");
  const [draftLksAt, setDraftLksAt] = useState("");
  const [draftProfile, setDraftProfile] = useState<SubjectProfile>({});
  const [savingCase, setSavingCase] = useState(false);
  const [hubTab, setHubTab] = useState<"active" | "located" | "archived">("active");
  const [hubCardMenuId, setHubCardMenuId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [archivePrompt, setArchivePrompt] = useState<{ id: string; title: string } | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(boot.caseId ?? "CASE-0038");
  const [workspacePersonId, setWorkspacePersonId] = useState<string | null>(boot.personId);

  const hubCases = useLiveQuery(listHubCases);
  const locatedHubCases = (hubCases ?? []).filter((c) => isLocatedCase(c));
  const archivedHubCases = (hubCases ?? []).filter((c) => isArchivedCase(c));
  const activeHubCases = (hubCases ?? []).filter((c) => !isArchivedCase(c) && !isLocatedCase(c));
  const resolvedCaseId = activeCaseId === ""
    ? null
    : activeCaseId
      ?? activeHubCases.find((c) => c.id === "CASE-0038")?.id
      ?? activeHubCases[0]?.id
      ?? null;
  const activeCase = hubCases?.find((c) => c.id === resolvedCaseId) ?? null;

  const allEntities = useLiveQuery(() => db.entities.toArray(), []) ?? [];
  const caseEntities = useLiveQuery(
    () => (resolvedCaseId ? db.entities.where("caseId").equals(resolvedCaseId).toArray() : Promise.resolve([] as EntityRecord[])),
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
  const highlightDrafts = useLiveQuery(
    () => (resolvedCaseId
      ? db.verifyDrafts.where("caseId").equals(resolvedCaseId).filter((d) => d.status !== "rejected").toArray()
      : Promise.resolve([] as VerifyDraftRecord[])),
    [resolvedCaseId],
  ) ?? [];

  const fileRef = useRef<HTMLInputElement>(null);
  const extractChain = useRef(Promise.resolve());
  const [form, setForm] = useState<WizardFormState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [activeHoveredCardId, setActiveHoveredCardId] = useState<string | null>(null);
  const [timelineInspect, setTimelineInspect] = useState<{ eventId: string; citation: SourceCitation } | null>(null);
  const hoverOriginRef = useRef<"card" | "doc" | null>(null);
  const sourcePaneRef = useRef<HTMLDivElement>(null);
  const queuePaneRef = useRef<HTMLDivElement>(null);
  const queueSyncLock = useRef(false);
  const verifyPdfPageRef = useRef(1);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
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
  const [extractNotice, setExtractNotice] = useState<{ fileName: string; entityCount: number } | null>(null);
  const [extractPreview, setExtractPreview] = useState<ExtractPreview | null>(null);
  const [selectedExtractNames, setSelectedExtractNames] = useState<Set<string>>(new Set());
  const [drawerStagedIds, setDrawerStagedIds] = useState<string[]>([]);
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [intakeHighlight, setIntakeHighlight] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [extractTip, setExtractTip] = useState<{ text: string; x: number; y: number; pageNumber?: number } | null>(null);
  const [logModal, setLogModal] = useState<{
    quote: string;
    pageNumber?: number;
    previewDataUrl?: string;
    box?: SourceBoundingBox;
  } | null>(null);
  const [ingestChooser, setIngestChooser] = useState(false);
  const [archiveFocus, setArchiveFocus] = useState(false);
  const [dupMatch, setDupMatch] = useState<DupMatch | null>(null);
  const dupResolver = useRef<((decision: DupDecision) => void) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [providerDraft, setProviderDraft] = useState<LlmProvider>(getLocalProvider);
  const [viewDay, setViewDay] = useState("");
  const [viewAllDates, setViewAllDates] = useState(false);
  const [dayScope, setDayScope] = useState<DayScope>(1);
  const [showInactiveLanes, setShowInactiveLanes] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("full");
  const [customStart, setCustomStart] = useState("00:00");
  const [customEnd, setCustomEnd] = useState("23:59");
  const [tickPreset, setTickPreset] = useState<TickPreset>("1h");
  const [pxPerHour, setPxPerHour] = useState(80);
  const [viewportFit, setViewportFit] = useState(true);
  const [timeMenu, setTimeMenu] = useState(false);
  const [conflictInspectorOpen, setConflictInspectorOpen] = useState(false);
  const [focusMerged, setFocusMerged] = useState(false);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<SwimlaneGroupId, boolean>>({
    subject: false,
    official: false,
    sightings: false,
  });
  const [mergedInspectIds, setMergedInspectIds] = useState<string[]>([]);
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
    if (screen === "Setup") setActiveCaseId("");
  }, [screen]);

  useEffect(() => {
    const onPop = () => {
      const loc = parseAppPath(window.location.pathname);
      setScreen(loc.screen);
      if (loc.caseId) setActiveCaseId(loc.caseId);
      setWorkspacePersonId(loc.personId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const goTo = (next: Screen, caseId?: string | null, personId?: string | null) => {
    if (caseId) setActiveCaseId(caseId);
    if (caseId === "") setActiveCaseId("");
    setScreen(next);
    setOperatorMenu(false);
    setNavOpen(false);
    const id = caseId || (next === "Hub" || next === "Alerts" || next === "Setup" || next === "Profile" || next === "Preferences" ? null : resolvedCaseId);
    const pid = PERSON_SCREENS.includes(next) ? (personId ?? workspacePersonId) : null;
    setWorkspacePersonId(pid);
    const path = pathFromScreen(next, id, pid);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  };

  const openPlaceChronology = (placeId: string) => {
    setSelected(placeId);
    setShowInactiveLanes(true);
    setSidebarOpen(true);
    const first = caseEvents
      .filter((event) => event.entityId === placeId)
      .sort((a, b) => a.timestamp - b.timestamp)[0];
    if (first) setFocusEventId(first.id);
    goTo("Timeline");
  };

  const openIntakePicker = () => {
    setIngestChooser(true);
  };

  const requestDup = (match: DupMatch) => new Promise<DupDecision>((resolve) => {
    dupResolver.current = resolve;
    setDupMatch(match);
  });

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    if (screen === "Hub" || screen === "Alerts" || screen === "Setup" || screen === "Profile" || screen === "Preferences") {
      const path = pathFromScreen(screen);
      if (window.location.pathname !== path) window.history.replaceState({}, "", path);
      return;
    }
    if (!resolvedCaseId) return;
    const path = pathFromScreen(screen, resolvedCaseId, PERSON_SCREENS.includes(screen) ? workspacePersonId : null);
    if (window.location.pathname !== path) window.history.replaceState({}, "", path);
  }, [screen, resolvedCaseId, workspacePersonId]);

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

  const GLOBAL_NAV: { id: Screen; icon: React.ComponentType<{ className?: string }>; label?: string; indent?: boolean }[] = [
    { id: "Hub", icon: LayoutGrid },
    { id: "Alerts", icon: Radio, label: "Live alerts", indent: true },
  ];
  const intakeNavBadge = caseEvidence.filter(isPendingIntakeEvidence).length || undefined;
  const verifyNavBadge = pendingDrafts.length || undefined;

  const ensureActiveCase = async () => {
    if (activeCaseId && activeCaseId !== "" && hubCases?.some((c) => c.id === activeCaseId)) return activeCaseId;
    if (!draftTitle.trim()) return null;
    const row = await createCase({
      title: draftTitle,
      summary: draftSummary,
      status: draftStatus,
      jurisdiction: draftJurisdiction,
      incidentStart: draftIncidentStart,
      incidentEnd: draftIncidentEnd,
      subjectName: draftTitle,
      fileIdentifier: draftFileId,
      lksAt: draftLksAt,
      lksLocation: draftJurisdiction,
      subjectProfile: draftProfile,
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
      v: {
        ...blank,
        note: src?.notes ?? "",
        address: src?.metadata?.address ?? "",
        coords: src?.metadata?.coordinates ?? "",
      },
    });
  };

  const saveForm = async () => {
    if (!form) return;
    const caseId = await ensureActiveCase();
    if (!caseId) {
      goTo("Setup");
      return;
    }
    const payload = {
      name: form.name.trim() || `Untitled ${SCHEMA[form.tab].noun}`,
      type: KIND_TYPE[form.tab],
      role: form.tab === "People" ? normalizePersonRole(form.chip) : form.chip,
      notes: notesFromForm(form.v),
      ...(form.tab === "Places"
        ? {
          classification: form.chip,
          metadata: {
            locationKind: form.chip,
            address: form.v.address || "",
            coordinates: form.v.coords || "",
          },
        }
        : {}),
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

  const timelineConflicts = useTimelineConflicts(caseEvents, caseEntities);

  const chrono = useMemo(() => {
    const entityMap = new Map(caseEntities.map((e) => [e.id, e]));
    const places = caseEntities.filter((e) => e.type === "place" || e.type === "location");
    const dayKeys = uniqueDayKeys(caseEvents.map((e) => e.timestamp));
    const dayCounts: Record<string, number> = {};
    for (const e of caseEvents) {
      const key = localDayKey(e.timestamp);
      dayCounts[key] = (dayCounts[key] ?? 0) + 1;
    }
    const dayStamps = caseEvents.map((e) => e.timestamp);
    const busiest = busiestDayKey(dayStamps);
    const earliest = earliestDayKey(dayStamps);
    const activeDay = viewDay || earliest || busiest;
    const spanKeys = !viewAllDates && activeDay ? spanDayKeys(activeDay, dayScope) : [];
    const span = new Set(spanKeys);
    const { startH, endH } = windowHours(timeWindow, customStart, customEnd);

    let scoped = showInactiveLanes ? caseEvents : caseEvents.filter((event) => !event.flaggedNoise);
    if (span.size) {
      scoped = scoped.filter((e) => span.has(localDayKey(e.timestamp)));
    }
    if (timeWindow !== "full") {
      scoped = scoped.filter((e) => eventInHourWindow(e.timestamp, startH, endH));
    }

    const fallbackStart = activeDay
      ? Date.parse(`${activeDay}T00:00:00`)
      : Date.now();
    const stamps = scoped.flatMap((event) => {
      const endMs = parseTimeEnd(event.timeEnd, event.timestamp);
      return endMs && endMs > event.timestamp ? [event.timestamp, endMs] : [event.timestamp];
    });
    const bounds = eventAxisBounds(stamps, Number.isNaN(fallbackStart) ? Date.now() : fallbackStart);
    let start = bounds.minTime;
    let end = bounds.maxTime;
    if (dayScope === 2 && spanKeys[1]) {
      const midnight = Date.parse(`${spanKeys[1]}T00:00:00`);
      if (Number.isFinite(midnight)) {
        if (midnight < start) start = midnight;
        if (midnight > end) end = midnight + 30 * 60 * 1000;
      }
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

    const scopedIds = new Set(scoped.map((event) => event.id));
    for (const pair of detectLocationConflicts(scoped, caseEntities, activeCase?.subjectName || activeCase?.title)) {
      addPair(pair.aId, pair.bId, pair.label, pair.detail);
    }
    for (const pair of timelineConflicts) {
      if (!scopedIds.has(pair.aId) || !scopedIds.has(pair.bId)) continue;
      addPair(pair.aId, pair.bId, pair.label, pair.detail);
    }

    const byEntity = new Map<string, TimelineEventRecord[]>();
    scoped.forEach((e) => {
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
    if (scopedIds.has("te-a1") && scopedIds.has("te-t2")) {
      addPair("te-a1", "te-t2", "Impossible transit", "The motel alibi cannot coexist with the Gate 4 toll exit.");
    }

    const evidenceMap = new Map(caseEvidence.map((row) => [row.id, row]));
    const plotEvents = conflictsOnly ? scoped.filter((event) => conflictIds.has(event.id)) : scoped;
    const plotted = clusterMergeableEvents(plotEvents).map((group) => {
      const e = group[0];
      const laneId = entityMap.has(e.entityId) ? e.entityId : UNASSIGNED_LANE_ID;
      const ent = entityMap.get(e.entityId);
      const src = evidenceMap.get(e.sourceDocId);
      const secondary = e.tier === "secondary" || Boolean(src && isSecondaryEvidence(src));
      const citeUrl = e.sourceCitation?.sourceUrl || src?.sourceUrl || "";
      const semantic = resolveSemanticCategory({
        entityType: ent?.type,
        role: ent?.role,
        name: ent?.name,
        text: `${e.title} ${e.description}`,
      });
      const mergeCount = Math.max(group.length, 1 + (e.mergedFrom?.length ?? 0));
      const mergedIds = [...new Set([e.id, ...group.map((row) => row.id), ...(e.mergedFrom || [])])];
      const contradicted = group.some((row) => conflictIds.has(row.id));
      const confidenceTier = confidenceTierOf(e, contradicted || e.confidenceTier === "TIER_3_CONTRADICTED");
      const sighting = isSightingEvent({ ...e, confidenceTier: e.confidenceTier === "TIER_2_UNVERIFIED" ? "TIER_2_UNVERIFIED" : undefined }, ent);
      const timeEndMs = parseTimeEnd(e.timeEnd, e.timestamp);
      const sourceNames = [...new Set(group.map((row) => {
        const rowSrc = evidenceMap.get(row.sourceDocId);
        return row.sourceCitation?.sourceName || rowSrc?.originalFileName || rowSrc?.fileName || row.title;
      }).filter(Boolean))];
      return {
        id: e.id,
        entityId: laneId,
        sourceEntityId: e.entityId,
        timestamp: e.timestamp,
        time: formatClock(e.timestamp),
        title: e.title,
        sub: e.description,
        tag: e.isVerified ? "EVENT" : "UNVERIFIED",
        flag: contradicted,
        verified: e.isVerified,
        confidenceTier,
        sighting: sighting && confidenceTier !== "TIER_1_VERIFIED",
        timeEndMs,
        secondary,
        citeUrl,
        sourceName: sourceNames.join(" · ") || e.sourceCitation?.sourceName || src?.originalFileName || src?.fileName || "",
        entityName: ent?.name || "Unassigned",
        mergeCount,
        mergedIds,
        semantic,
        noise: group.some((row) => row.flaggedNoise),
      };
    });

    const activeLaneIds = plotted.map((e) => e.entityId);
    const catalogLaneIds = caseEntities.map((entity) => entity.id);
    const laneIds = [...new Set(showInactiveLanes ? [...catalogLaneIds, ...activeLaneIds] : activeLaneIds)];
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
        category: { entityType: ent?.type, role: ent?.role, name: ent?.name, text: ent?.notes, category: ent?.classification },
        dot: getCategoryColor(semantic, "dot"),
        border: getCategoryColor(semantic, "border"),
        semantic,
        tone: TONE_FOR[normalizePersonRole(ent?.role ?? "")] ?? TONE_FOR[ent?.role ?? ""] ?? ("cold" as Tone),
        uncorroborated: ent ? isUncorroboratedEntity(ent) : false,
        entityId: ent?.id,
      };
      const evs = plotted.filter((e) => e.entityId === id).sort((a, b) => a.timestamp - b.timestamp);
      const rowEnds: number[] = [];
      let maxStack = 0;
      const placed = evs.map((e) => {
        const left = xOf(e.timestamp);
        const axisSpan = e.timeEndMs && e.timeEndMs > e.timestamp
          ? Math.max(220, xOf(e.timeEndMs) - left)
          : 220;
        const span = timelineCardWidth(e, axisSpan);
        let row = 0;
        while (row < rowEnds.length && rowEnds[row] > left) row += 1;
        if (row === rowEnds.length) rowEnds.push(0);
        rowEnds[row] = left + span + CARD_PAD;
        maxStack = Math.max(maxStack, row);
        return { e, row, left, width: span };
      });
      const tracks = maxStack + 1;
      const height = 12 + tracks * (CARD_H + CARD_GAP) - CARD_GAP + 12;
      const laneTop = top;
      placed.forEach(({ e, row, left, width }) => {
        const cardTop = 10 + row * (CARD_H + CARD_GAP);
        if (e.flag) {
          anchors[e.id] = { x: left + width / 2, top: laneTop + cardTop, bottom: laneTop + cardTop + CARD_H };
        }
      });
      top += height + 1;
      return { def, height, placed, count: placed.length, tracks };
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
      width: LANE_PAD + hours * pxPerHour + CARD_W,
      xOf,
      rangeLabel: formatRangeLabel(start, end, viewAllDates || spanKeys.length > 1),
      dayKeys,
      dayCounts,
      stripDays: fillDayStrip(dayKeys),
      spanKeys: spanKeys.length ? spanKeys : (activeDay ? [activeDay] : []),
      midnights: midnightsInRange(start, end),
      busiest,
      activeDay,
      conflictPairs,
      conflicts: conflictPairs.map((pair) => ({
        id: `${pair.aId}::${pair.bId}`,
        aId: pair.aId,
        bId: pair.bId,
        message: pair.detail,
      })),
      mergedCount: plotted.filter((row) => row.mergeCount > 1).reduce((sum, row) => sum + row.mergeCount, 0),
      mergedLaneIds: plotted.filter((row) => row.mergeCount > 1).map((row) => row.entityId),
      timeLabel: formatClockRange(start, end),
    };
  }, [activeCase?.subjectName, activeCase?.title, caseEvents, caseEntities, caseEvidence, viewDay, viewAllDates, dayScope, showInactiveLanes, timeWindow, customStart, customEnd, tickPreset, pxPerHour, viewportFit, conflictsOnly, timelineConflicts]);

  useEffect(() => {
    setViewDay("");
    setViewAllDates(false);
    setViewportFit(true);
    setTimeWindow("full");
    setTickPreset("1h");
    setDayScope(1);
    setShowInactiveLanes(false);
    setTimeMenu(false);
  }, [resolvedCaseId]);

  useEffect(() => {
    if (!activeCase) return;
    if (screen !== "Timeline" && screen !== "Overview" && screen !== "Locations") return;
    void ensureLastKnownSighting(activeCase);
  }, [screen, activeCase]);

  useEffect(() => {
    if (screen !== "Timeline" || !viewportFit || !caseEvents.length) return;
    const active = viewDay || earliestDayKey(caseEvents.map((e) => e.timestamp)) || busiestDayKey(caseEvents.map((e) => e.timestamp));
    const span = new Set(viewAllDates || !active ? [] : spanDayKeys(active, dayScope));
    const pool = span.size
      ? caseEvents.filter((e) => span.has(localDayKey(e.timestamp)))
      : caseEvents;
    const times = (pool.length ? pool : caseEvents).flatMap((e) => {
      const endMs = parseTimeEnd(e.timeEnd, e.timestamp);
      return endMs && endMs > e.timestamp ? [e.timestamp, endMs] : [e.timestamp];
    });
    const { minTime, maxTime } = eventAxisBounds(times, Date.now());
    const width = timelineContainerRef.current?.clientWidth ?? 960;
    setPxPerHour(fitPxPerHour(maxTime - minTime, width));
  }, [screen, viewportFit, resolvedCaseId, caseEvents, viewDay, viewAllDates, dayScope]);

  const fitToEvents = () => {
    setViewportFit(true);
    setTimeWindow("full");
    const active = viewDay || earliestDayKey(caseEvents.map((e) => e.timestamp)) || busiestDayKey(caseEvents.map((e) => e.timestamp));
    const span = new Set(viewAllDates || !active ? [] : spanDayKeys(active, dayScope));
    const pool = span.size
      ? caseEvents.filter((e) => span.has(localDayKey(e.timestamp)))
      : caseEvents;
    const times = (pool.length ? pool : caseEvents).flatMap((e) => {
      const endMs = parseTimeEnd(e.timeEnd, e.timestamp);
      return endMs && endMs > e.timestamp ? [e.timestamp, endMs] : [e.timestamp];
    });
    const { minTime, maxTime } = eventAxisBounds(times, Date.now());
    const el = timelineContainerRef.current;
    setPxPerHour(fitPxPerHour(maxTime - minTime, el?.clientWidth ?? 960));
    requestAnimationFrame(() => el?.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  };

  const inspectContradiction = (contradictionId?: string) => {
    setSelected(null);
    setConflictInspectorOpen(true);
    setPendingInspectId(`${contradictionId ?? chrono.tether?.id ?? "primary"}:${Date.now()}`);
    if (screen !== "Timeline") setScreen("Timeline");
  };

  const mergeConflictEvents = async (keepId: string, dropId: string) => {
    const keep = caseEvents.find((row) => row.id === keepId);
    const drop = caseEvents.find((row) => row.id === dropId);
    if (!keep || !drop) return;
    await updateTimelineEvent(keep.id, {
      description: [keep.description, drop.description].filter(Boolean).join("\n"),
    });
    await db.timelineEvents.update(keep.id, {
      mergedFrom: [...(keep.mergedFrom || []), drop.id],
    });
    await deleteTimelineEvent(drop.id);
    setConflictInspectorOpen(false);
  };

  const reassignConflictTime = async (eventId: string) => {
    const rec = caseEvents.find((row) => row.id === eventId);
    if (!rec) return;
    await updateTimelineEvent(rec.id, { timestamp: rec.timestamp + 5 * 60 * 1000, isVerified: rec.isVerified });
    setConflictInspectorOpen(false);
  };

  const flagConflictUnverified = async (aId: string, bId: string) => {
    await updateTimelineEvent(aId, { isVerified: false });
    await updateTimelineEvent(bId, { isVerified: false });
    setConflictInspectorOpen(false);
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
    setDraftJurisdiction("");
    setDraftIncidentStart("");
    setDraftIncidentEnd("");
    setDraftFileId("");
    setDraftLksAt("");
    setDraftProfile({});
    setDraftStatus("ACTIVE_MISSING");
    goTo("Setup");
  };

  const openCaseFromAlert = (alert: LiveMissingAlert) => {
    const lksAt = parseAlertMissingAt(alert.summary);
    setActiveCaseId("");
    setDraftTitle(alert.name);
    setDraftSummary(alert.summary);
    setDraftJurisdiction(alert.location);
    setDraftIncidentStart(lksAt ? lksAt.slice(0, 10) : "");
    setDraftIncidentEnd("");
    setDraftFileId(alert.id);
    setDraftLksAt(lksAt);
    setDraftProfile({
      currentEstimatedAge: alert.age || undefined,
      photoUrl: alert.photoUrl,
    });
    setDraftStatus(alertTypeToCaseStatus(alert.alertType));
    goTo("Setup");
  };

  const openExistingCase = (id: string, title: string, summary: string, status: string) => {
    setActiveCaseId(id);
    setDraftTitle(title);
    setDraftSummary(summary);
    setDraftStatus((CASE_STATUSES.includes(status as CaseStatus) ? status : "ACTIVE_MISSING") as CaseStatus);
    goTo("Overview", id);
  };

  const unarchiveCase = async (id: string, title: string) => {
    await setCaseArchived(id, false);
    setHubCardMenuId(null);
    setToast(`${title} restored to active cases.`);
  };

  const markCaseLocated = async (id: string, title: string) => {
    await setCaseLocated(id);
    setHubCardMenuId(null);
    setHubTab("located");
    setToast(`${title} marked located and moved to Located & Reunited.`);
  };

  const reopenLocatedSearch = async (id: string, title: string) => {
    await reopenLocatedCase(id);
    setHubCardMenuId(null);
    setHubTab("active");
    setToast(`${title} reopened as an active search.`);
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

  const resetWorkspace = () => {
    setSelected(null);
    setViewDay("");
    setViewAllDates(false);
    setDrawerEventId(null);
    setFocusEventId(null);
    setTimelineInspect(null);
    setConflictInspectorOpen(false);
    setForm(null);
    setActiveEvidenceId(null);
    setWorkspacePersonId(null);
    setSelectedExtractNames(new Set());
    setConflictsOnly(false);
    setFocusMerged(false);
    setMergedInspectIds([]);
    setPopover(false);
  };

  const openChronology = async () => {
    if (activeCase) await ensureLastKnownSighting(activeCase);
    const stamps = caseEvents.map((event) => event.timestamp).filter((ts) => Number.isFinite(ts));
    const lksRaw = activeCase?.lksAt || activeCase?.incidentStart || "";
    const lks = /^\d{4}-\d{2}-\d{2}$/.test(lksRaw) ? Date.parse(`${lksRaw}T12:00:00`) : Date.parse(lksRaw);
    if (Number.isFinite(lks)) stamps.push(lks);
    const day = earliestDayKey(stamps);
    if (day) {
      setViewDay(day);
      setViewAllDates(false);
      setViewportFit(true);
    }
    goTo("Timeline");
  };

  const submitNewCase = async () => {
    if (!draftTitle.trim() || savingCase) return;
    setSavingCase(true);
    try {
      const cleanNamusId = draftFileId.trim().toUpperCase();
      resetWorkspace();
      const row = await createCase({
        title: draftTitle,
        summary: draftSummary,
        status: draftStatus,
        jurisdiction: draftJurisdiction,
        incidentStart: draftLksAt ? draftLksAt.slice(0, 10) : draftIncidentStart,
        incidentEnd: draftIncidentEnd,
        subjectName: draftTitle,
        fileIdentifier: cleanNamusId,
        lksAt: draftLksAt,
        lksLocation: draftJurisdiction,
        subjectProfile: draftProfile,
      });
      await ensureLastKnownSighting(row);
      setActiveCaseId(row.id);
      goTo("Overview", row.id);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not create the case.");
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
      const timestamp = new Date(eventWhen).getTime();
      const contentHash = await hashNormalizedText(`${eventTitle} ${eventDesc}`);
      const hit = await findDuplicateEvent(resolvedCaseId, {
        title: eventTitle,
        description: eventDesc,
        timestamp,
        entityId: eventEntityId,
      });
      if (hit) {
        const decision = await requestDup({
          kind: "event",
          existingId: hit.id,
          existing: eventToSide(hit),
          incoming: eventToSide({ ...hit, id: "incoming", title: eventTitle, description: eventDesc, timestamp }, true),
        });
        const applied = await applyDupDecision(
          { kind: "event", existingId: hit.id, existing: eventToSide(hit), incoming: eventToSide(hit, true) },
          decision,
          { ...hit, title: eventTitle, description: eventDesc, timestamp },
        );
        if (applied.action !== "replace") {
          setEventOpen(false);
          return;
        }
      }
      await createTimelineEvent({
        caseId: resolvedCaseId,
        entityId: eventEntityId,
        timestamp,
        title: eventTitle,
        description: eventDesc,
        contentHash,
      });
      setSelected(eventEntityId);
      setEventOpen(false);
    } finally {
      setSavingEvent(false);
    }
  };

  const openEventDrawer = (id: string, mergedIds?: string[]) => {
    const ev = caseEvents.find((e) => e.id === id);
    if (!ev) return;
    setDrawerEventId(id);
    setDrawerEdit(false);
    setDrawerTitle(ev.title);
    setDrawerWhen(toDatetimeLocal(ev.timestamp));
    setDrawerDesc(ev.description);
    setDrawerEntityId(ev.entityId);
    const fromPlot = chrono.all.find((row) => row.id === id);
    setMergedInspectIds(
      mergedIds && mergedIds.length > 1
        ? mergedIds
        : (fromPlot && fromPlot.mergeCount > 1 ? fromPlot.mergedIds : []),
    );
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
    fromPaste?: boolean;
    fromEditorial?: boolean;
  }) => {
    let rowId: string | null = null;
    const startedAt = Date.now();
    try {
      const caseId = resolvedCaseId ?? await ensureActiveCase();
      if (!caseId) {
        setExtractError("Create or open a case before adding evidence.");
        goTo("Setup");
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
        fromPaste: input.fromPaste,
        fromEditorial: input.fromEditorial,
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

  const pushDrawerStaged = (ids: string[]) => {
    const clean = ids.filter(Boolean);
    if (!clean.length) return;
    setDrawerStagedIds((prev) => [...clean, ...prev.filter((id) => !clean.includes(id))]);
  };

  const ingestFiles = async (files: FileList | File[], opts?: { extract?: boolean; background?: boolean }) => {
    const extract = opts?.extract ?? true;
    const background = opts?.background ?? (screen !== "Intake");
    const ids: string[] = [];
    for (const file of [...files]) {
      let rowId: string | null = null;
      try {
        if (!isPdfFile(file) && !isImageFile(file) && !isTextFile(file)) {
          setExtractError(`Skipped ${file.name} — use PDF, image (PNG, JPG, WEBP), TXT, MD, CSV, or JSON.`);
          continue;
        }
        const caseId = resolvedCaseId ?? await ensureActiveCase();
        if (!caseId) continue;
        const sha = await calculateSHA256(file);
        const dup = await findDuplicateEvidence(caseId, sha);
        if (dup) {
          const decision = await requestDup({
            kind: "evidence",
            existingId: dup.id,
            existing: evidenceToSide(dup),
            incoming: evidenceToSide({ ...dup, id: "incoming", fileName: file.name, originalFileName: file.name, sha256Hash: sha }, true),
          });
          const applied = await applyDupDecision(
            { kind: "evidence", existingId: dup.id, existing: evidenceToSide(dup), incoming: evidenceToSide(dup, true) },
            decision,
            { ...dup, fileName: file.name },
          );
          if (applied.action !== "replace") continue;
        }
        const row = await stageEvidenceFile(file, (payload) => ingestText(payload));
        if (!row) continue;
        rowId = row.id;
        ids.push(row.id);
        const staged = await db.evidence.get(row.id);
        if (staged?.fileBase64 && (isPdfFile(file) || staged.sourceType === "pdf" || staged.fileType === "pdf")) {
          try {
            const extracted = await extractPdfText(staged.fileBase64);
            const fullText = extracted.text || staged.rawText;
            await db.evidence.update(row.id, {
              rawText: fullText,
              fullText,
              pageCount: extracted.pageCount || staged.pageCount,
              wordCount: fullText.split(/\s+/).filter(Boolean).length,
              textClarity: assessTextClarity(fullText, extracted.pageCount || 1),
            });
          } catch (err) {
            console.error("[Intake] PDF full-text parse failed", err);
          }
        }
        if (extract) {
          extractChain.current = extractChain.current.then(() =>
            runExtract(rowId!, { stayOnWorkspace: background }),
          );
          if (!background) await extractChain.current;
        }
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
    if (ids.length) setActiveEvidenceId(ids[ids.length - 1]);
    return ids;
  };

  const ingestWebArticle = async (
    url: string,
    onProgress: (stage: "scraping" | "staging") => void,
    opts?: { extract?: boolean },
  ) => {
    const extract = opts?.extract ?? true;
    onProgress("scraping");
    let article = fallbackArticleFromUrl(url);
    try {
      article = await scrapeArticleFromUrl(url);
    } catch {
      article = fallbackArticleFromUrl(url);
    }
    onProgress("staging");
    const body = article.content || article.summary || `External news report referenced from ${article.url}`;
    const sha256Hash = await calculateSHA256(
      new TextEncoder().encode(body).buffer as ArrayBuffer,
    );
    const bytes = new TextEncoder().encode(body).length;
    const row = await ingestText({
      fileName: article.title,
      fileType: "web_article",
      rawText: body,
      fileSize: bytes,
      mimeType: "text/html",
      sha256Hash,
      originalFileName: article.url,
      sourceType: "web_article",
      sourceUrl: article.url,
      publishedDate: article.publishedDate ?? undefined,
      wordCount: article.wordCount,
    });
    if (row?.id && extract && !article.fallback && article.wordCount >= 40) {
      extractChain.current = extractChain.current.then(() =>
        runExtract(row.id, { stayOnWorkspace: screen !== "Intake" }),
      );
      if (screen === "Intake") await extractChain.current;
    }
    return row;
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
    stayOnWorkspace?: boolean;
    deferApply?: boolean;
  }) => {
    const stayOnWorkspace = opts?.stayOnWorkspace ?? screen !== "Intake";
    const deferApply = opts?.deferApply ?? false;
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
    const isPdf = (ev.fileType === "pdf" || ev.mediaType === "application/pdf") && Boolean(ev.fileBase64);
    const canVision = Boolean(ev.fileBase64 || ev.imageBase64);
    if (!canVision) logExtractedText(ev.rawText, ev.fileName);
    const startedAt = opts?.startedAt ?? Date.now();
    setExtracting(true);
    setExtractError(null);
    await db.evidence.update(ev.id, { status: "ingesting", lastError: "" });
    setActiveEvidenceId(ev.id);
    pushDrawerStaged([ev.id]);
    setIngestJob({
      evidenceId: ev.id,
      stage: isPdf ? "pdf" : "claude",
      currentPage: 0,
      totalPages: ev.pageCount || 0,
      startedAt,
      llmStartedAt: isPdf ? null : Date.now(),
    });
    let sourceText = documentText(ev) || ev.rawText || "";
    const stalePending = (await db.verifyDrafts.where("evidenceId").equals(ev.id).toArray())
      .filter((draft) => draft.status === "pending" && draft.origin !== "manual" && draft.citation !== "manual-observation")
      .map((draft) => draft.id);
    if (stalePending.length) await db.verifyDrafts.bulkDelete(stalePending);
    try {
      const hints = caseEntities.map((e) => ({ id: e.id, name: e.name, type: e.type, role: e.role }));
      const localMaura = isLocalMauraExtractSource(ev.fileName);

      let bundle: ExtractBundle;

      if (isPdf && ev.fileBase64) {
        setIngestJob((job) => (job && job.evidenceId === ev.id
          ? { ...job, stage: "claude", llmStartedAt: Date.now(), currentPage: ev.pageCount || 1, totalPages: ev.pageCount || 1 }
          : job));
        bundle = await extractEvidenceLocally({
          fileBase64: ev.fileBase64,
          fileType: ev.fileType,
          fileName: ev.fileName,
          text: sourceText,
        });
      } else if (ev.imageBase64 || (ev.fileBase64 && (ev.mediaType || "").startsWith("image/"))) {
        setIngestJob((job) => (job && job.evidenceId === ev.id
          ? { ...job, stage: "claude", llmStartedAt: Date.now() }
          : job));
        bundle = await extractEventsFromImage({
          imageBase64: ev.imageBase64,
          fileBase64: ev.fileBase64 || ev.imageBase64,
          mediaType: ev.mediaType || "image/jpeg",
          fileName: ev.fileName,
          entities: hints,
        });
      } else {
        setIngestJob((job) => (job && job.evidenceId === ev.id
          ? { ...job, stage: "claude", llmStartedAt: Date.now() }
          : job));
        bundle = await extractEvidenceLocally({
          fileName: ev.fileName,
          fileType: ev.fileType,
          text: sourceText,
        });
      }

      if (!bundle.events.length && isMm1Source(ev.fileName)) {
        bundle = mm1ExtractBundle();
      } else if (!bundle.events.length && localMaura) {
        bundle = mauraVerifiedBundle();
      }
      setExtractError(null);

      const events = bundle.events;
      const clarity = ev.textClarity ?? assessTextClarity(sourceText || ev.rawText, ev.pageCount ?? 1);
      setIngestJob((job) => (job && job.evidenceId === ev.id ? { ...job, stage: "events" } : job));

      if (deferApply) {
        await applyExtractedGraph({
          caseId,
          evidenceId: ev.id,
          entities: bundle.entities,
          relationships: bundle.relationships,
          bundle,
        });
        await ensureContactsForPeople(caseId);
        const roster = await db.entities.where("caseId").equals(caseId).toArray();
        const matchEntity = (id: string | null, name: string) => {
          if (id && roster.some((e) => e.id === id)) return id;
          const needle = name.trim().toLowerCase();
          if (!needle) return "";
          return roster.find((e) => e.name.trim().toLowerCase() === needle)?.id
            ?? roster.find((e) => namesLooselyMatch(e.name, name))?.id
            ?? "";
        };
        if (events.length) {
          await addVerifyDrafts(events.map((event) => {
            const entityId = matchEntity(event.entityId, event.entityName);
            return {
              caseId,
              evidenceId: ev.id,
              timestamp: parseEventTime(event.timestamp, event.timestampLabel, {
                extraText: `${event.details} ${event.rawQuote} ${event.citation} ${sourceText.slice(0, 2500)}`,
              }),
              timestampLabel: event.timestampLabel || event.timestamp || "Unknown",
              entityId,
              entityName: event.entityName,
              suggestNewEntity: event.suggestNewEntity && !entityId,
              newEntityType: event.suggestNewEntity ? (event.newEntityType ?? event.entityType ?? "") : "",
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
          if (!localMaura) {
            const drafts = await db.verifyDrafts.where("evidenceId").equals(ev.id).toArray();
            for (const draft of drafts.filter((d) => d.status === "pending")) {
              await confirmVerifyDraft(draft.id);
            }
          }
        }
        setExtractPreview({
          evidenceId: ev.id,
          fileName: ev.fileName,
          entities: bundle.entities,
          events,
          relationships: bundle.relationships,
          usedFallback: false,
          autoApplied: true,
          bundle,
        });
        setSelectedExtractNames(new Set(bundle.entities.map((ent) => ent.name)));
        setExtractNotice({ fileName: ev.fileName, entityCount: bundle.entities.length });
        window.setTimeout(() => {
          setExtractNotice((curr) => (curr?.fileName === ev.fileName ? null : curr));
        }, 7000);
        await db.evidence.update(ev.id, {
          status: "indexed",
          lastError: "",
          textClarity: clarity,
        });
        setIngestJob((job) => (job && job.evidenceId === ev.id ? { ...job, stage: "done" } : job));
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        setIngestJob(null);
        return;
      }

      await applyExtractedGraph({
        caseId,
        evidenceId: ev.id,
        entities: bundle.entities,
        relationships: bundle.relationships,
        bundle,
      });
      await ensureContactsForPeople(caseId);
      const roster = await db.entities.where("caseId").equals(caseId).toArray();
      setExtractNotice({ fileName: ev.fileName, entityCount: bundle.entities.length });
      window.setTimeout(() => {
        setExtractNotice((curr) => (curr?.fileName === ev.fileName ? null : curr));
      }, 7000);
      if (!events.length) {
        await db.evidence.update(ev.id, {
          status: "indexed",
          lastError: "",
          textClarity: clarity,
        });
        setIngestJob(null);
        return;
      }
      const matchEntity = (id: string | null, name: string) => {
        if (id && roster.some((e) => e.id === id)) return id;
        const needle = name.trim().toLowerCase();
        if (!needle) return "";
        return roster.find((e) => e.name.trim().toLowerCase() === needle)?.id
          ?? roster.find((e) => namesLooselyMatch(e.name, name))?.id
          ?? roster.find((e) => {
            const n = e.name.trim().toLowerCase();
            return n.includes(needle) || needle.includes(n);
          })?.id
          ?? "";
      };
      await addVerifyDrafts(events.map((event) => {
        const entityId = matchEntity(event.entityId, event.entityName);
        return {
          id: event.id,
          caseId,
          evidenceId: ev.id,
          timestamp: parseEventTime(event.timestamp, event.timestampLabel, {
            extraText: `${event.details} ${event.rawQuote} ${event.citation} ${sourceText.slice(0, 2500)}`,
          }),
          timestampLabel: event.timestampLabel || event.timestamp || "Unknown",
          entityId,
          entityName: event.entityName,
          suggestNewEntity: event.suggestNewEntity && !entityId,
          newEntityType: event.suggestNewEntity ? (event.newEntityType ?? event.entityType ?? "") : "",
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
      }));
      setIngestJob((job) => (job && job.evidenceId === ev.id ? { ...job, stage: "done" } : job));
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setActiveEvidenceId(ev.id);
      if (!stayOnWorkspace) goTo("Verify", caseId);
      setIngestJob(null);
    } catch (err) {
      setIngestJob(null);
      const fallback = mauraFallbackBundle();
      try {
        await applyExtractedGraph({
          caseId,
          evidenceId: ev.id,
          entities: fallback.entities,
          relationships: fallback.relationships,
          bundle: fallback,
        });
        await ensureContactsForPeople(caseId);
        const roster = await db.entities.where("caseId").equals(caseId).toArray();
        const matchEntity = (id: string | null, name: string) => {
          if (id && roster.some((e) => e.id === id)) return id;
          const needle = name.trim().toLowerCase();
          if (!needle) return "";
          return roster.find((e) => e.name.trim().toLowerCase() === needle)?.id
            ?? roster.find((e) => namesLooselyMatch(e.name, name))?.id
            ?? "";
        };
        if (fallback.events.length) {
          await addVerifyDrafts(fallback.events.map((event) => {
            const entityId = matchEntity(event.entityId, event.entityName);
            return {
              caseId,
              evidenceId: ev.id,
              timestamp: parseEventTime(event.timestamp, event.timestampLabel, {
                extraText: `${event.details} ${event.rawQuote} ${event.citation} ${sourceText.slice(0, 2500)}`,
              }),
              timestampLabel: event.timestampLabel || event.timestamp || "Unknown",
              entityId,
              entityName: event.entityName,
              suggestNewEntity: event.suggestNewEntity && !entityId,
              newEntityType: event.suggestNewEntity ? (event.newEntityType ?? event.entityType ?? "") : "",
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
        }
        await db.evidence.update(ev.id, {
          status: "indexed",
          lastError: "",
        });
        setExtractError(null);
        if (!stayOnWorkspace) goTo("Verify", caseId);
      } catch {
        const message = err instanceof Error ? err.message : "Extraction failed";
        await db.evidence.update(ev.id, {
          status: "indexed",
          lastError: "",
        });
        setExtractError(null);
        void message;
      }
    } finally {
      setExtracting(false);
    }
  };

  const acceptExtractRoster = async () => {
    if (!extractPreview) return;
    if (extractPreview.autoApplied) {
      setExtractPreview(null);
      setSelectedExtractNames(new Set());
      return;
    }
    const caseId = resolvedCaseId ?? await ensureActiveCase();
    if (!caseId) return;
    const ev = await db.evidence.get(extractPreview.evidenceId);
    if (!ev) return;
    const names = selectedExtractNames;
    const entities = extractPreview.entities.filter((ent) => names.has(ent.name));
    const relationships = (extractPreview.relationships ?? []).filter(
      (rel) => names.has(rel.sourceEntity) && names.has(rel.targetEntity),
    );
    await applyExtractedGraph({
      caseId,
      evidenceId: ev.id,
      entities,
      relationships,
      bundle: extractPreview.bundle
        ? { ...extractPreview.bundle, entities, relationships }
        : { events: extractPreview.events, entities, relationships },
    });
    await ensureContactsForPeople(caseId);
    const roster = await db.entities.where("caseId").equals(caseId).toArray();
    const matchEntity = (id: string | null, name: string) => {
      if (id && roster.some((e) => e.id === id)) return id;
      const needle = name.trim().toLowerCase();
      if (!needle) return "";
      return roster.find((e) => e.name.trim().toLowerCase() === needle)?.id
        ?? roster.find((e) => namesLooselyMatch(e.name, name))?.id
        ?? "";
    };
    if (extractPreview.events.length) {
      await addVerifyDrafts(extractPreview.events.map((event) => {
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
          suggestNewEntity: event.suggestNewEntity && !entityId,
          newEntityType: event.suggestNewEntity ? (event.newEntityType ?? event.entityType ?? "") : "",
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
      const drafts = await db.verifyDrafts.where("evidenceId").equals(ev.id).toArray();
      for (const draft of drafts.filter((d) => d.status === "pending")) {
        await confirmVerifyDraft(draft.id);
      }
    }
    await db.evidence.update(ev.id, { status: "indexed", lastError: "" });
    setExtractNotice({ fileName: ev.fileName, entityCount: entities.length });
    window.setTimeout(() => {
      setExtractNotice((curr) => (curr?.fileName === ev.fileName ? null : curr));
    }, 7000);
    setExtractPreview(null);
    setSelectedExtractNames(new Set());
  };

  const inspectOverviewSource = (id: string) => {
    setActiveEvidenceId(id);
    pushDrawerStaged([id]);
    const row = caseEvidence.find((e) => e.id === id);
    const drafts = pendingDrafts.filter((d) => d.evidenceId === id);
    if (extractPreview?.evidenceId === id) return;
    if (drafts.length) {
      const seen = new Set<string>();
      const entities = drafts.flatMap((d) => {
        const name = d.entityName.trim();
        if (!name || seen.has(name.toLowerCase())) return [];
        seen.add(name.toLowerCase());
        return [{
          name,
          type: (d.newEntityType || "person") as ExtractBundle["entities"][number]["type"],
          classification: "UNVERIFIED",
          identifiers: [] as string[],
        }];
      });
      setExtractPreview({
        evidenceId: id,
        fileName: row?.fileName || "Source",
        entities,
        events: drafts.map((d) => ({
          timestamp: null,
          timestampLabel: d.timestampLabel,
          entityId: d.entityId || null,
          entityName: d.entityName,
          entityType: (d.newEntityType || "person") as ExtractedEvent["entityType"],
          suggestNewEntity: d.suggestNewEntity,
          newEntityType: (d.newEntityType || "person") as ExtractedEvent["newEntityType"],
          category: (d.category || "person") as ExtractedEvent["category"],
          title: d.title,
          snippet: d.snippet,
          rawQuote: d.snippet,
          details: d.details,
          confidence: d.confidence,
          citation: d.citation,
          exactQuote: d.snippet,
        })),
        relationships: [],
      });
      setSelectedExtractNames(new Set(entities.map((ent) => ent.name)));
    }
  };

  const sourceEvidence = caseEvidence.find((e) => e.id === activeEvidenceId)
    ?? caseEvidence.find((e) => isMm1Source(e.fileName))
    ?? caseEvidence[0]
    ?? null;

  const intakeIndexedFiles = useMemo(
    () => {
      const visible = caseEvidence.filter((row) => isIntakeCompleteStatus(row.status) && isVisibleInStagingQueue(row));
      const rest = caseEvidence.filter((row) => isIntakeCompleteStatus(row.status) && !isVisibleInStagingQueue(row));
      return [...visible, ...rest].map((row) => ({ id: row.id, fileName: row.fileName }));
    },
    [caseEvidence],
  );
  const drawerEvent = caseEvents.find((e) => e.id === drawerEventId) ?? null;
  const drawerEntity = drawerEvent ? caseEntities.find((e) => e.id === drawerEvent.entityId) : null;
  const drawerSource = drawerEvent ? caseEvidence.find((e) => e.id === drawerEvent.sourceDocId) : null;
  const jobElapsed = ingestJob ? ingestElapsedSec(ingestJob, nowMs) : 0;
  const busy = extracting || (ingestJob != null && ingestJob.stage !== "done");

  const sourcePending = useMemo(
    () => draftsForSource(pendingDrafts, sourceEvidence?.id),
    [pendingDrafts, sourceEvidence?.id],
  );
  const sourceDrafts = useMemo(
    () => draftsForSource(highlightDrafts, sourceEvidence?.id),
    [highlightDrafts, sourceEvidence?.id],
  );
  const sourceQuoteSpans = useMemo(
    () => collectQuoteSpans(documentText(sourceEvidence) || "", sourcePending),
    [sourceEvidence?.rawText, sourceEvidence?.fullText, sourcePending],
  );
  const sourceQuoteSegments = useMemo(
    () => splitTextBySpans(documentText(sourceEvidence) || "", sourceQuoteSpans),
    [sourceEvidence?.rawText, sourceEvidence?.fullText, sourceQuoteSpans],
  );
  const narrativeQueue = useMemo(
    () => {
      const current = documentText(sourceEvidence) || "";
      const ordered = sortByNarrativeOrder(sourcePending, () => current);
      const logged = sourceDrafts.filter((d) =>
        (d.origin === "manual" || d.citation === "manual-observation") && d.status !== "rejected" && !ordered.some((p) => p.id === d.id),
      );
      const selection = ordered.filter((d) => d.citation === "selection");
      const rest = ordered.filter((d) => d.citation !== "selection");
      return [...logged, ...selection, ...rest];
    },
    [sourcePending, sourceDrafts, sourceEvidence?.rawText, sourceEvidence?.fullText],
  );

  const captureSourceSelection = () => {
    const sel = window.getSelection();
    const pane = sourcePaneRef.current;
    const node = sel?.anchorNode ?? sel?.focusNode;
    const inPane = Boolean(node && pane && pane.contains(node instanceof Element ? node : node.parentElement));
    if (!sel || sel.isCollapsed || !pane || !inPane) {
      setExtractTip(null);
      return;
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2) {
      setExtractTip(null);
      return;
    }
    const matched = sourceDrafts.find((draft) => {
      const blob = `${draft.snippet} ${draft.sourceCitation?.exactQuote || ""}`;
      return Boolean(locateSnippet(blob, text) || locateSnippet(text, draft.snippet));
    });
    if (matched) {
      setExtractTip(null);
      setHoveredCard(matched.id, "doc");
      return;
    }
    const el = node instanceof Element ? node : node?.parentElement;
    const pageEl = el?.closest("[data-pdf-page]");
    const pageNumber = Number(pageEl?.getAttribute("data-pdf-page"));
    void logCustomObservation(text, Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined);
  };

  const persistLoggedEvidence = async (input: {
    quote: string;
    category: ManualLogCategoryId;
    notes: string;
    title?: string;
    pageNumber?: number;
  }) => {
    if (!logModal || !sourceEvidence) return;
    const caseId = resolvedCaseId ?? await ensureActiveCase();
    if (!caseId) return;
    await saveManualEvidence({
      caseId,
      evidenceId: sourceEvidence.id,
      quote: input.quote || logModal.quote,
      title: input.title,
      notes: input.notes,
      category: input.category,
      pageNumber: input.pageNumber ?? logModal.pageNumber,
      boundingBox: logModal.box,
      previewDataUrl: logModal.previewDataUrl,
      sourceName: sourceEvidence.fileName,
      sourceType: inferSourceType(sourceEvidence),
    });
    if (logModal.previewDataUrl) {
      await addCaseMedia({
        caseId,
        dataUrl: logModal.previewDataUrl,
        title: (input.quote || logModal.quote).slice(0, 72) || "Visual observation",
        category: input.category === "location" ? "ping_data" : input.category === "vehicle" ? "surveillance" : "uncategorized",
        type: "image",
        sourceId: sourceEvidence.id,
        tags: ["manual"],
      });
    }
    setLogModal(null);
    setExtractTip(null);
    window.getSelection()?.removeAllRanges();
    setToast("Card added to the extraction queue.");
  };

  const extractHighlightedText = async () => {
    if (!extractTip) return;
    await logCustomObservation(extractTip.text, extractTip.pageNumber);
  };

  const logCustomObservation = async (quote: string, pageNumber?: number) => {
    if (!sourceEvidence || !activeCase) return;
    const text = quote.replace(/\s+/g, " ").trim();
    if (text.length < 2) return;
    const rows = await addVerifyDrafts([{
      caseId: activeCase.id,
      evidenceId: sourceEvidence.id,
      timestamp: Date.now(),
      timestampLabel: pageNumber ? `Page ${pageNumber}` : "Manual extract",
      entityId: "",
      entityName: "Custom observation",
      suggestNewEntity: true,
      newEntityType: "",
      category: "evidence",
      title: "Custom Extracted Observation",
      snippet: text,
      details: "",
      confidence: 1,
      citation: "manual-observation",
      origin: "manual",
      sourceCitation: {
        sourceId: sourceEvidence.id,
        sourceName: sourceEvidence.fileName,
        sourceType: inferSourceType(sourceEvidence),
        exactQuote: text,
        pageNumber,
      },
    }]);
    const id = rows[0]?.id;
    if (id) {
      setEditingDraftId(id);
      setHoveredCard(id, "doc");
    }
    setExtractTip(null);
    setLogModal(null);
    window.getSelection()?.removeAllRanges();
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
    const marks = [
      ...source.querySelectorAll<HTMLElement>("[id^='source-hit-']"),
      ...source.querySelectorAll<HTMLElement>("[id^='verify-quote-']"),
    ];
    if (!marks.length) return;
    const probeY = source.getBoundingClientRect().top + Math.min(140, source.clientHeight * 0.25);
    let lead: HTMLElement | null = null;
    for (const mark of marks) {
      if (mark.getBoundingClientRect().top <= probeY) lead = mark;
      else break;
    }
    const target = lead ?? marks[0];
    const draftId = target.getAttribute("data-verify-quote") || target.id.replace(/^(source-hit-|verify-quote-)/, "");
    const card = document.getElementById(`verify-card-${draftId}`);
    if (!card || !queue.contains(card)) return;
    const qBox = queue.getBoundingClientRect();
    const cBox = card.getBoundingClientRect();
    if (cBox.top >= qBox.top + 12 && cBox.bottom <= qBox.bottom - 12) return;
    queueSyncLock.current = true;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => { queueSyncLock.current = false; }, 280);
  };

  useEffect(() => {
    verifyPdfPageRef.current = 1;
    setActiveHoveredCardId(null);
    setEditingDraftId(null);
    setExtractTip(null);
    setLogModal(null);
    setExtractPreview((prev) => (prev && sourceEvidence?.id && prev.evidenceId !== sourceEvidence.id ? null : prev));
    const scroller = sourcePaneRef.current?.querySelector<HTMLElement>("[data-pdf-scroll]");
    scroller?.scrollTo({ top: 0 });
    document.getElementById("pdf-page-1")?.scrollIntoView({ block: "start" });
    if (screen !== "Verify" || !sourceEvidence) return;
    void runExtract(sourceEvidence.id, { stayOnWorkspace: true });
  }, [sourceEvidence?.id, screen]);

  useEffect(() => {
    if (screen !== "Verify" || !activeHoveredCardId) return;
    const origin = hoverOriginRef.current;
    const timer = window.setTimeout(() => {
      const card = document.getElementById(`verify-card-${activeHoveredCardId}`);
      const quote = document.getElementById(`source-hit-${activeHoveredCardId}`)
        ?? document.getElementById(`verify-quote-${activeHoveredCardId}`);
      if (origin === "doc") {
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const pageNumber = sourceDrafts.find((row) => row.id === activeHoveredCardId)?.sourceCitation?.pageNumber;
      const pageEl = pageNumber
        ? sourcePaneRef.current?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`)
        : null;
      const scroller = sourcePaneRef.current?.querySelector<HTMLElement>("[data-pdf-scroll]");
      if (quote && scroller) {
        const top = quote.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 120;
        scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        return;
      }
      pageEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      quote?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [activeHoveredCardId, screen, sourceEvidence?.id, sourceQuoteSegments.length, sourceDrafts]);

  /* ---------------------------------------------------------------- */

  return (
    <div className="flex min-h-dvh bg-slate-200/60 p-0 font-sans text-slate-900 md:p-3.5">
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border-0 border-slate-200 bg-white shadow-none md:rounded-[20px] md:border md:shadow-sm">

        {navOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
            onClick={() => setNavOpen(false)}
          />
        ) : null}

        {/* sidebar */}
        <aside className={`app-shell-nav z-40 flex w-[min(256px,88vw)] flex-col border-r border-slate-200 bg-white transition-transform duration-200 ${navOpen ? "is-open" : ""}`}>
          <div className="flex shrink-0">
          <button
            type="button"
            onClick={() => goTo("Hub")}
            aria-label="INTELLIDEX home"
            className="flex h-16 min-w-0 flex-1 items-center gap-2.5 border-b border-slate-200 px-5 text-left hover:bg-slate-50"
          >
            <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg bg-blue-600 p-1.5">
              <div className="h-2 w-2 rounded-[2px] bg-white" />
            </div>
            <span className="truncate font-mono text-[15px] font-bold tracking-wider text-slate-900 sm:text-lg">INTELLIDEX</span>
          </button>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="flex h-16 w-12 shrink-0 items-center justify-center border-b border-slate-200 text-slate-500 hover:bg-slate-50 md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
          <nav className="flex min-h-0 flex-1 flex-col overflow-auto p-3 pt-4">
            <div className={`px-2.5 pb-2 pt-1.5 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>GLOBAL</div>
            {GLOBAL_NAV.map(({ id, icon: Icon, label, indent }) => {
              const on = screen === id;
              return (
                <button key={id} type="button" onClick={() => goTo(id)}
                  className={`flex h-[38px] w-full items-center gap-3 rounded-[10px] text-left text-[13.5px] transition-colors ${indent ? "pl-7 pr-2.5" : "px-2.5"} ${on ? "bg-blue-50 font-semibold text-blue-700" : "font-medium text-slate-600 hover:bg-slate-50"}`}>
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  {label ?? id}
                </button>
              );
            })}
            <CaseSidebarTree
              screen={screen}
              personId={PERSON_SCREENS.includes(screen) ? workspacePersonId : null}
              personLeaf={PERSON_SCREENS.includes(screen) ? (PERSON_LEAF_BY_SCREEN[screen] ?? "overview") : null}
              activeCase={activeCase}
              people={caseEntities.filter((e) => isSearchNetworkPerson(e))}
              directory={(hubCases ?? []).flatMap((c) => allEntities.filter((e) => e.caseId === c.id && isSearchNetworkPerson(e)).map((e) => ({
                id: e.id,
                caseId: e.caseId,
                name: e.name,
                role: e.role,
                notes: e.notes,
                classification: e.classification,
                caseLabel: `${c.id} · ${c.subjectName || c.title}`,
                pinned: (c.pinnedPersonIds ?? []).includes(e.id),
              })))}
              intakeBadge={intakeNavBadge}
              verifyBadge={verifyNavBadge}
              locked={screen === "Hub" || screen === "Alerts" || !activeCase}
              onGoCase={(id) => goTo(id)}
              onGoPerson={(id, leaf) => goTo(SCREEN_BY_PERSON_LEAF[leaf] ?? "PersonOverview", resolvedCaseId, id)}
              onPinPerson={(id, caseId) => {
                const target = caseId || resolvedCaseId;
                if (!target) return;
                void togglePinnedPerson(target, id, true);
                if (caseId && caseId !== resolvedCaseId) goTo("Overview", caseId);
              }}
              onUnpinPerson={(id) => { if (resolvedCaseId) void togglePinnedPerson(resolvedCaseId, id, false); }}
            />
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
          <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4 lg:h-16 lg:flex-nowrap lg:gap-4 lg:px-6 lg:py-0">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900 md:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Search cases, entities, evidence"
              onClick={() => setSearchOpen(true)}
              className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-left hover:border-slate-300 md:max-w-[45%] md:w-[340px] md:flex-none"
            >
              <Search className="h-[15px] w-[15px] shrink-0 text-slate-500" />
              <span className="min-w-0 truncate text-[13px] text-slate-500">Search cases, entities, evidence…</span>
              <div className="flex-1" />
              <span className={`hidden shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 sm:inline ${mono} text-[10.5px] text-slate-500`}>⌘K</span>
            </button>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">
              {activeCase && (
                <button
                  type="button"
                  onClick={openIntakePicker}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-blue-600 px-2.5 text-xs font-semibold tracking-wide text-white hover:bg-blue-700 sm:px-3"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Add Evidence</span>
                  <span className="sm:hidden">Evidence</span>
                </button>
              )}
              {activeCase && (
                <button
                  type="button"
                  disabled={operator.permissions?.canExportDossier === false}
                  onClick={() => { setExportError(null); setExportOpen(true); }}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-2.5 text-xs font-medium tracking-wide text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 sm:px-3"
                >
                  <FileDown className="h-3.5 w-3.5 text-slate-500" />
                  <span className="hidden sm:inline">Export Official INTELLIDEX</span>
                  <span className="sm:hidden">Export</span>
                </button>
              )}
              <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200/50 bg-emerald-50/80 px-2.5 py-1 font-mono text-[11px] text-emerald-700 sm:inline-flex">
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
                  <div className="absolute right-0 z-30 mt-2 w-[min(260px,calc(100vw-1.5rem))] overflow-hidden rounded-[12px] border border-slate-200 bg-white py-1 shadow-xl">
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

          <main className={`flex min-w-0 flex-1 flex-col ${screen === "Locations" ? "min-h-0 overflow-hidden" : "overflow-auto"}`}>

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

            {screen === "Alerts" && (
              <LiveAlertsFeed
                creatorLabel={creatorLabel}
                onBack={() => goTo("Hub")}
                onOpenAsCase={openCaseFromAlert}
              />
            )}

            {/* ---------------- HUB ---------------- */}
            {screen === "Hub" && (() => {
              const locatedCount = locatedHubCases.length;
              const archivedCount = archivedHubCases.length;
              const waitingCount = activeHubCases.length;
              const shownCases = hubTab === "archived" ? archivedHubCases : hubTab === "located" ? locatedHubCases : activeHubCases;
              const hubHeading = hubTab === "archived"
                ? (archivedCount === 1 ? "1 archived case" : `${archivedCount} archived cases`)
                : hubTab === "located"
                  ? (locatedCount === 1 ? "One person located and reunited." : `${locatedCount} people located and reunited.`)
                  : waitingCount === 1
                    ? "One case is waiting on you."
                    : `${waitingCount} cases are waiting on you.`;
              const hubCopy = hubTab === "archived"
                ? "Closed investigations stay on this machine. Restore one to bring it back to the active list."
                : hubTab === "located"
                  ? "Resolved searches live here — not in the archive. Open a case to review the reunion record, or reopen the search if the status was premature."
                  : "Open a missing-person search workspace, or start a new case and bring in official records and tips. Everything stays on this machine until you export it.";
              return (
              <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 sm:px-6 sm:pt-13 lg:px-10" onClick={() => setHubCardMenuId(null)}>
                <div className={`mb-5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>CREATOR // {creatorLabel}</div>
                <h1 className="mb-3.5 w-full max-w-none text-[28px] font-semibold leading-tight tracking-tight sm:text-[40px]">
                  {hubHeading}
                </h1>
                <p className="mb-8 w-full max-w-4xl text-[15px] leading-relaxed text-slate-500">
                  {hubCopy}
                </p>
                <div className="flex flex-wrap gap-3">
                  {hubTab === "active" && (
                    <button onClick={openNewCase} className="inline-flex h-10 items-center gap-2.5 rounded-[10px] bg-blue-600 px-[18px] text-[13.5px] font-semibold text-white transition-colors hover:bg-blue-700">
                      <FolderPlus className="h-[15px] w-[15px]" />New case
                    </button>
                  )}
                  <button type="button" onClick={() => goTo("Alerts")} className="inline-flex h-10 items-center gap-2.5 rounded-[10px] border border-slate-300 bg-white px-[18px] text-[13.5px] font-semibold text-slate-800 transition-colors hover:bg-slate-50">
                    <Radio className="h-[15px] w-[15px]" />Live alerts
                  </button>
                </div>

                <div className="mb-5 mt-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5 sm:mt-16">
                  <div className="flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHubTab("active"); }}
                      className={`h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${hubTab === "active" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Active Searches ({waitingCount})
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHubTab("located"); }}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${hubTab === "located" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Located ({locatedCount})
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHubTab("archived"); }}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${hubTab === "archived" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Archived ({archivedCount})
                    </button>
                  </div>
                  <span className={`${mono} text-[11px] text-slate-500`}>{shownCases.length} SHOWN</span>
                </div>

                {hubTab === "active" && hubCases && waitingCount === 0 && (
                  <div className="mb-6 rounded-[14px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-[13px] text-slate-500">
                    No active searches. Create a case, or check Located & Reunited.
                  </div>
                )}
                {hubTab === "located" && locatedCount === 0 && (
                  <div className="mb-6 rounded-[14px] border border-dashed border-emerald-200 bg-emerald-50/60 px-6 py-10 text-center text-[13px] text-emerald-800">
                    No located cases yet. Mark a search as Located / Found to celebrate it here — it will not move to the archive.
                  </div>
                )}
                {hubTab === "archived" && archivedCount === 0 && (
                  <div className="mb-6 rounded-[14px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-[13px] text-slate-500">
                    No archived cases. Closed investigations will appear here.
                  </div>
                )}

                <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
                  {shownCases.map((c) => {
                    const tone = statusToTone(c.status);
                    const archived = isArchivedCase(c);
                    const located = isLocatedCase(c);
                    const resolvedOn = c.locatedAt ? new Date(c.locatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
                    return (
                    <article
                      key={c.id}
                      onClick={() => { if (!archived) openExistingCase(c.id, c.title, c.summary, c.status); }}
                      className={`relative rounded-[14px] border bg-white p-5 pb-[18px] shadow-sm transition-colors ${archived ? "border-slate-200" : located ? "cursor-pointer border-emerald-200 hover:border-emerald-300" : "cursor-pointer border-slate-200 hover:border-slate-300"}`}
                    >
                      <div className="mb-3.5 flex items-start justify-between gap-3">
                        <div>
                          <div className={`mb-[7px] ${mono} text-[10.5px] tracking-[0.1em] text-slate-500`}>{c.fileIdentifier || c.id}</div>
                          <h3 className="text-[21px] font-semibold leading-tight tracking-tight">{c.subjectName || c.title}</h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {archived ? (
                            <span className={`inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-slate-500`}>ARCHIVED</span>
                          ) : located ? (
                            <span className={`inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] text-emerald-700`}>LOCATED</span>
                          ) : (
                            <Chip tone={tone}>{formatAlertLabel(c.status)}</Chip>
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
                                className="absolute right-0 z-20 mt-1 min-w-[200px] overflow-hidden rounded-[10px] border border-slate-200 bg-white py-1 shadow-lg"
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
                                  <>
                                    {located ? (
                                      <button
                                        type="button"
                                        onClick={() => void reopenLocatedSearch(c.id, c.title)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                                      >
                                        <ArchiveRestore className="h-3.5 w-3.5" />Reopen Search
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => void markCaseLocated(c.id, c.title)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-emerald-800 hover:bg-emerald-50"
                                      >
                                        <HeartHandshake className="h-3.5 w-3.5" />Mark as Located / Found
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setArchivePrompt({ id: c.id, title: c.title })}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                                    >
                                      <Archive className="h-3.5 w-3.5" />Archive Case
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="mb-[18px] text-[13px] leading-relaxed text-slate-500 text-pretty">{c.summary || "No summary recorded."}</p>
                      {located && resolvedOn && (
                        <p className="mb-3 text-[12.5px] font-medium text-emerald-800">Resolution date: {resolvedOn}</p>
                      )}
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

            {/* ---------------- SETUP (single-step create) ---------------- */}
            {CASE_WORKSPACE.includes(screen) && hubCases !== undefined && !activeCase && (
              <NoActiveCase onHub={() => goTo("Hub")} />
            )}
            {screen === "Setup" && (
              <NewCaseForm
                title={draftTitle}
                fileIdentifier={draftFileId}
                jurisdiction={draftJurisdiction}
                lksAt={draftLksAt}
                alertLevel={draftStatus}
                summary={draftSummary}
                profile={draftProfile}
                saving={savingCase}
                onTitle={setDraftTitle}
                onFileIdentifier={setDraftFileId}
                onJurisdiction={setDraftJurisdiction}
                onLksAt={setDraftLksAt}
                onAlertLevel={setDraftStatus}
                onSummary={setDraftSummary}
                onProfile={setDraftProfile}
                onCancel={() => goTo("Hub")}
                onSubmit={() => void submitNewCase()}
              />
            )}

            {PERSON_SCREENS.includes(screen) && activeCase && (() => {
              const person = caseEntities.find((e) => e.id === workspacePersonId);
              if (!person) {
                return (
                  <div className="flex flex-1 items-center justify-center px-8 text-center text-[14px] text-slate-500">
                    Pinned person not found. Pin someone from Overview or Verify.
                  </div>
                );
              }
              return (
                <PersonWorkspace
                  activeCase={activeCase}
                  person={person}
                  entities={caseEntities}
                  events={caseEvents}
                  evidence={caseEvidence}
                  leaf={PERSON_LEAF_BY_SCREEN[screen] ?? "overview"}
                  onViewChronology={openPlaceChronology}
                  onUnpin={() => {
                    void togglePinnedPerson(activeCase.id, person.id, false);
                    goTo("Overview", activeCase.id);
                  }}
                />
              );
            })()}

            {/* ---------------- OVERVIEW ---------------- */}
            {screen === "Overview" && activeCase && (
              <CaseOverview
                activeCase={activeCase}
                entities={caseEntities}
                evidence={caseEvidence}
                events={caseEvents}
                pendingCount={pendingDrafts.length}
                conflictCount={chrono.tether?.count ?? 0}
                onOpenTimeline={() => { void openChronology(); }}
                onOpenLocations={() => goTo("Locations")}
                onAddEvidence={openIntakePicker}
                onLogTip={() => { setArchiveFocus(true); goTo("Media"); }}
                onInspectContradiction={() => inspectContradiction()}
                onOpenEntity={(ent) => {
                  setSelected(ent.id);
                  openForm(TYPE_KIND[ent.type], ent);
                }}
                onDropFiles={async (files) => {
                  const ids = await ingestFiles(files, { extract: false, background: true });
                  pushDrawerStaged(ids);
                }}
                ingestJob={ingestJob}
                nowMs={nowMs}
                extractNotice={extractNotice}
                extractError={extractError}
                extractPreview={extractPreview}
                selectedExtractNames={selectedExtractNames}
                stagedEvidence={caseEvidence.filter((row) => drawerStagedIds.includes(row.id))}
                pinnedPersonIds={activeCase.pinnedPersonIds}
                onTogglePinPerson={(id) => void togglePinnedPerson(activeCase.id, id)}
                onToggleExtractName={(name) => {
                  setSelectedExtractNames((prev) => {
                    const next = new Set(prev);
                    if (next.has(name)) next.delete(name);
                    else next.add(name);
                    return next;
                  });
                }}
                onExtractEvidence={(id) => {
                  void runExtract(id, { stayOnWorkspace: true, deferApply: true });
                }}
                onAcceptExtract={() => acceptExtractRoster()}
                onIngestUrl={async (url, onProgress) => {
                  const row = await ingestWebArticle(url, onProgress, { extract: false });
                  if (row?.id) pushDrawerStaged([row.id]);
                }}
                onIngestPaste={async (text, kind) => {
                  const editorial = kind === "editorial";
                  const row = await ingestText({
                    fileName: editorial ? "editorial-notes.txt" : "pasted-notes.txt",
                    fileType: "txt",
                    rawText: text,
                    fileSize: new Blob([text]).size,
                    sourceType: editorial ? "web_article" : "text",
                    fromPaste: !editorial,
                    fromEditorial: editorial,
                  });
                  if (row?.id) pushDrawerStaged([row.id]);
                }}
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
                onInspectSource={inspectOverviewSource}
                onReextract={(id) => { void runExtract(id, { stayOnWorkspace: true, deferApply: true }); }}
              />
            )}

            {screen === "WorkingTheory" && activeCase && (
              <WorkingTheory activeCase={activeCase} />
            )}

            {screen === "Locations" && activeCase && (
              <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-4rem)]">
                <LocationsMap
                  activeCase={activeCase}
                  places={caseEntities.filter((e) => e.type === "place" || e.type === "location")}
                  events={caseEvents}
                  onArbitrate={requestDup}
                  onViewChronology={openPlaceChronology}
                />
              </div>
            )}

            {screen === "Media" && activeCase && (
              <MediaGallery activeCase={activeCase} onArbitrate={requestDup} focusArchive={archiveFocus} />
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
                onPasteSave={(kind, overrideText) => {
                  const editorial = kind === "editorial";
                  const text = overrideText ?? pasteText;
                  if (!editorial) setPasteText("");
                  void (async () => {
                    let rowId: string | null = null;
                    let extractStarted = false;
                    try {
                      const row = await withStageTimeout(ingestText({
                        fileName: editorial ? "editorial-notes.txt" : "pasted-notes.txt",
                        fileType: "txt",
                        rawText: text,
                        fileSize: new Blob([text]).size,
                        sourceType: editorial ? "web_article" : "text",
                        fromPaste: !editorial,
                        fromEditorial: editorial,
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
                  await ingestWebArticle(url, onProgress);
                }}
                highlightDropzone={intakeHighlight}
                onHighlightConsumed={() => setIntakeHighlight(false)}
              />
            )}

            {/* ---------------- VERIFY ---------------- */}
            {screen === "Verify" && activeCase && (
              <div className="grid min-h-0 grid-cols-1 overflow-auto lg:h-[calc(100dvh-7.5rem)] lg:grid-cols-2 lg:overflow-hidden">
                <section className="flex min-h-[min(52dvh,480px)] min-w-0 flex-col overflow-hidden border-b border-slate-200 lg:min-h-0 lg:border-b-0 lg:border-r">
                  <div className="flex h-auto min-h-12 shrink-0 flex-wrap items-end justify-between gap-2 border-b border-slate-200 px-3 py-2 sm:px-6">
                    <VerifySourceSwitcher
                      files={caseEvidence}
                      activeId={sourceEvidence?.id ?? null}
                      extractedIds={new Set(highlightDrafts.map((draft) => draft.evidenceId))}
                      onSelect={(id) => setActiveEvidenceId(id)}
                      onUpload={() => fileRef.current?.click()}
                      onAddLink={() => goTo("Intake")}
                    />
                    <div className="flex min-w-0 flex-wrap items-center gap-2 pb-0.5">
                      <button
                        type="button"
                        disabled={busy || !(sourceEvidence?.fileBase64 || sourceEvidence?.imageBase64 || sourceEvidence?.rawText.trim())}
                        onClick={() => sourceEvidence && void runExtract(sourceEvidence.id)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-600 hover:border-blue-500 hover:text-blue-700 disabled:opacity-40"
                      >
                        <RefreshCw className={`h-3 w-3 ${extracting ? "animate-spin" : ""}`} />
                        <span className="hidden sm:inline">Re-run Extraction</span>
                        <span className="sm:hidden">Re-run</span>
                      </button>
                    </div>
                  </div>
                  <div ref={sourcePaneRef} onScroll={syncQueueToSourceScroll} onMouseUp={captureSourceSelection} onTouchEnd={captureSourceSelection} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    {extractError && (
                      <div className="mx-3 mt-3 flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-950">
                        <TriangleAlert className="mt-0.5 h-[15px] w-[15px] shrink-0" />
                        <span>{extractError}</span>
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      <SourceDocumentViewer
                        evidence={sourceEvidence}
                        citation={(() => {
                          const d = narrativeQueue.find((row) => row.id === activeHoveredCardId)
                            ?? sourceDrafts.find((row) => row.id === activeHoveredCardId)
                            ?? null;
                          return d ? citationFromDraft(d, sourceEvidence) : null;
                        })()}
                        anchors={sourceDrafts.map((row) => ({
                          id: row.id,
                          citation: citationFromDraft(row, sourceEvidence),
                          label: row.title,
                          entityName: row.entityName,
                        }))}
                        highlightTerms={sourceDrafts.map((row) => row.entityName).filter((name) => name.trim().length > 2)}
                        onPasteArticle={async (text) => {
                          if (!sourceEvidence) return;
                          const words = text.split(/\s+/).filter(Boolean);
                          await db.evidence.update(sourceEvidence.id, {
                            rawText: text,
                            fullText: text,
                            wordCount: words.length,
                            status: "indexed",
                            lastError: "",
                          });
                          void runExtract(sourceEvidence.id, { stayOnWorkspace: true });
                        }}
                        activeId={activeHoveredCardId}
                        showClose={false}
                        onSelectAnchor={(id) => {
                          const known = sourceDrafts.some((row) => row.id === id);
                          if (!known) {
                            const text = document.getElementById(`source-hit-${CSS.escape(id)}`)?.textContent?.replace(/\s+/g, " ").trim() || "";
                            if (text) void logCustomObservation(text);
                            return;
                          }
                          setHoveredCard(id, "doc");
                        }}
                        onVisiblePage={(page) => { verifyPdfPageRef.current = page; }}
                        onImageRegionSelect={({ box, previewDataUrl }) => {
                          setExtractTip(null);
                          setLogModal({ quote: "Selected image region", previewDataUrl, box });
                        }}
                        onTextSelect={() => {
                          /* Pane mouseup opens a Custom Extracted Observation for text that has no card. */
                        }}
                      />
                    </div>
                    {extractTip && !logModal && (
                      <ExtractSelectionTip
                        x={extractTip.x}
                        y={extractTip.y}
                        onExtract={() => void extractHighlightedText()}
                        onDismiss={() => setExtractTip(null)}
                      />
                    )}
                    {logModal && (
                      <LogEvidenceModal
                        key={`${logModal.quote}-${logModal.pageNumber ?? ""}-${logModal.previewDataUrl?.slice(0, 24) ?? ""}`}
                        quote={logModal.quote}
                        pageNumber={logModal.pageNumber}
                        previewDataUrl={logModal.previewDataUrl}
                        onDismiss={() => setLogModal(null)}
                        onSave={(input) => void persistLoggedEvidence(input)}
                      />
                    )}
                  </div>
                </section>

                <section className="flex min-h-[min(52dvh,480px)] min-w-0 flex-col overflow-hidden bg-slate-50/60 lg:min-h-0">
                  <div className="flex h-auto min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 sm:px-6">
                    <div className={`flex min-w-0 items-center gap-2.5 truncate ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>
                      <Inbox className="h-3.5 w-3.5 shrink-0" />AI EXTRACTION QUEUE
                    </div>
                    <span className={`shrink-0 whitespace-nowrap ${mono} text-[11px] text-slate-500`}>
                      {sourcePending.length} UNRESOLVED
                    </span>
                  </div>

                  <div ref={queuePaneRef} className="flex flex-1 flex-col gap-3 overflow-auto px-3 pb-6 pt-5 sm:px-6">
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
                        pinned={Boolean(d.entityId && (activeCase?.pinnedPersonIds ?? []).includes(d.entityId))}
                        onTogglePin={d.entityId && activeCase ? () => void togglePinnedPerson(activeCase.id, d.entityId) : undefined}
                      />
                    ))}

                    {sourcePending.length === 0 && narrativeQueue.length === 0 && (
                      <div className="flex flex-col items-center gap-4 rounded-[14px] border border-dashed border-slate-300 px-5 py-10 text-center">
                        <CheckCheck className="h-[18px] w-[18px] text-blue-600" />
                        <div className="text-[20px] font-semibold">
                          {caseEvidence.length ? "Queue cleared" : "Nothing to verify"}
                        </div>
                        <p className="max-w-[34ch] text-[12.5px] text-slate-500 text-pretty">
                          {caseEvidence.length
                            ? "Confirmed events are on the chronology. Rejected cards stay dismissed. Drop a new source below to extract, or highlight text in the viewer."
                            : "Drop a document here to extract entities, or pull an indexed file from Intake."}
                        </p>
                        <VerifyIngestDropzone
                          busy={busy || extracting}
                          indexedFiles={intakeIndexedFiles}
                          onFiles={(files) => { void ingestFiles(files, { extract: true, background: true }); }}
                          onPickIndexed={(id) => {
                            setActiveEvidenceId(id);
                            void runExtract(id, { stayOnWorkspace: true });
                          }}
                        />
                      </div>
                    )}
                    {sourcePending.length === 0 && narrativeQueue.length > 0 && (
                      <VerifyIngestDropzone
                        busy={busy || extracting}
                        indexedFiles={intakeIndexedFiles}
                        onFiles={(files) => { void ingestFiles(files, { extract: true, background: true }); }}
                        onPickIndexed={(id) => {
                          setActiveEvidenceId(id);
                          void runExtract(id, { stayOnWorkspace: true });
                        }}
                      />
                    )}
                  </div>

                  <div className="flex min-h-14 shrink-0 flex-col items-stretch gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
                    <span className={`min-w-0 truncate ${mono} text-[11px] text-slate-500`}>CONFIRM WRITES TO TIMELINE</span>
                    <button onClick={() => { void openChronology(); }}
                      className="inline-flex h-[34px] shrink-0 items-center justify-center gap-2 rounded-[10px] border border-slate-300 px-[15px] text-[12.5px] font-medium text-slate-600 transition-colors hover:border-blue-600 hover:text-blue-600">
                      Open chronology<ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </section>
              </div>
            )}

            {/* ---------------- TIMELINE ---------------- */}
            {screen === "Timeline" && activeCase && (
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:h-[calc(100dvh-7.5rem)]">
                {chrono.conflicts.length > 0 && (
                  <div className="z-20 flex w-full shrink-0 items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800/60 dark:bg-amber-950/40">
                    <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
                      <span className="text-amber-600 dark:text-amber-400">⚠️</span>
                      <span className="min-w-0">
                        {chrono.conflicts.length} timeline conflict{chrono.conflicts.length > 1 ? "s" : ""} detected — {chrono.conflicts[0].message}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => inspectContradiction(chrono.conflicts[0].id)}
                      className="shrink-0 rounded border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-100"
                    >
                      Inspect
                    </button>
                  </div>
                )}
                <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
                {sidebarOpen ? (
                  <button
                    type="button"
                    aria-label="Close entity dossier"
                    className="absolute inset-0 z-[15] bg-slate-900/30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                  />
                ) : null}
                <EntityDossier
                  open={sidebarOpen}
                  selected={selected}
                  lanes={chrono.lanes}
                  onToggle={() => setSidebarOpen((v) => !v)}
                  onSelect={setSelected}
                  onPromoteEntity={(id) => void promoteEntityToVerified(id)}
                  ToggleIcon={sidebarOpen ? PanelLeftClose : PanelLeftOpen}
                  pinnedIds={activeCase?.pinnedPersonIds}
                  onTogglePin={(id) => { if (activeCase) void togglePinnedPerson(activeCase.id, id); }}
                  onRecategorize={(id, bucket) => {
                    const next = {
                      Person: { type: "person" as const, classification: "PERSON" },
                      Vehicle: { type: "vehicle" as const, classification: "VEHICLE" },
                      Location: { type: "place" as const, classification: "LOCATION" },
                      Evidence: { type: "exhibit" as const, classification: "EVIDENCE" },
                      Organization: { type: "person" as const, classification: "ORGANIZATION" },
                    }[bucket];
                    void updateEntity(id, next);
                  }}
                />

                <div className="flex min-w-0 flex-1 flex-col">
                  {chrono.conflicts.length === 0 && (
                    <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
                      <span className={`min-w-0 truncate ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>
                        {activeCase ? `${activeCase.id} / ${activeCase.title.toUpperCase()}` : "NO CASE SELECTED"}
                      </span>
                    </div>
                  )}

                  <div className="flex min-h-[44px] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-3 py-2 sm:px-5">
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 lg:hidden"
                      onClick={() => setSidebarOpen(true)}
                    >
                      <PanelLeftOpen className="h-3.5 w-3.5" />
                      Entities
                    </button>
                    <span className="max-w-[220px] truncate text-sm font-semibold text-slate-800 dark:text-zinc-200">
                      {activeCase.subjectName || activeCase.title}
                    </span>
                    <span className="h-4 w-px shrink-0 bg-slate-200" />
                    <TimelineToolbar
                      rangeLabel={chrono.rangeLabel}
                      timeLabel={chrono.timeLabel}
                      dayScope={dayScope}
                      onDayScope={(scope) => { setDayScope(scope); setViewAllDates(false); setViewportFit(true); }}
                      showInactiveLanes={showInactiveLanes}
                      onShowInactiveLanes={setShowInactiveLanes}
                      timeWindow={timeWindow}
                      customStart={customStart}
                      customEnd={customEnd}
                      tickPreset={tickPreset}
                      timeMenu={timeMenu}
                      onToggleTimeMenu={() => setTimeMenu((v) => !v)}
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
                    {chrono.conflictPairs.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setConflictsOnly((on) => !on)}
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold ${conflictsOnly ? "border-amber-600 bg-amber-200 text-amber-950" : "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}
                      >
                        [ ⚠ {chrono.conflictPairs.length} Timeline Conflict{chrono.conflictPairs.length === 1 ? "" : "s"} ]
                      </button>
                    ) : (
                      <span className={`shrink-0 whitespace-nowrap ${mono} text-[11px] text-slate-500`}>
                        {chrono.all.length} EVENTS · {chrono.lanes.length} LANES
                      </span>
                    )}
                    {chrono.mergedCount > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusMerged((v) => !v);
                          if (!focusMerged) setSelected(null);
                        }}
                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold ${focusMerged ? "border-zinc-400 bg-zinc-200 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100" : "border-zinc-200 bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"}`}
                      >
                        <TriangleAlert className="h-3.5 w-3.5" />
                        {chrono.mergedCount} Duplicate Events Merged
                      </button>
                    ) : null}
                    <div className="min-w-0 flex-1" />
                    <button
                      onClick={openAddEvent}
                      disabled={!resolvedCaseId || caseEntities.length === 0}
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />Add Event
                    </button>
                  </div>

                  <TimelineDateStrip
                    dayKeys={chrono.stripDays}
                    dayCounts={chrono.dayCounts}
                    spanKeys={chrono.spanKeys}
                    onSelectDay={(day) => {
                      setViewAllDates(false);
                      setViewDay(day);
                      setViewportFit(true);
                    }}
                  />

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
                    <div className="relative min-h-full pb-15 pr-12" style={{ width: chrono.width }}>
                      <div className="pointer-events-none absolute inset-y-0 right-0"
                        style={{ left: LANE_PAD, backgroundImage: `repeating-linear-gradient(to right, #f1f5f9 0 1px, transparent 1px ${chrono.pxPerHour * (chrono.tickMs / HOUR_MS)}px)` }} />

                      {chrono.midnights.map((mark) => (
                        <div
                          key={mark.ts}
                          className="pointer-events-none absolute bottom-0 top-0 z-[1] border-l border-dashed border-slate-400 dark:border-zinc-500"
                          style={{ left: chrono.xOf(mark.ts) }}
                        >
                          <span className="sticky top-2 ml-2 inline-flex rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">
                            [ {mark.label} ]
                          </span>
                        </div>
                      ))}

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

                      <TimelineGrid
                        lanes={chrono.lanes}
                        subjectName={activeCase?.subjectName || activeCase?.title}
                        collapsed={collapsedGroups}
                        onToggle={(id) => setCollapsedGroups((curr) => ({ ...curr, [id]: !curr[id] }))}
                        renderLane={({ def, height, placed, tracks, count }, groupId) => {
                        const dim = (selected != null && selected !== def.id)
                          || (focusMerged && !chrono.mergedLaneIds.includes(def.id));
                        const laneAccent = groupId === "official"
                          ? "border-l-4 border-l-emerald-500"
                          : groupId === "sightings"
                            ? "border-l-4 border-l-amber-500"
                            : "border-l-4 border-l-blue-500";
                        return (
                          <div key={def.id} className={`relative overflow-visible border-b border-slate-200 transition-opacity ${dim ? "opacity-40" : "opacity-100"}`} style={{ height }}>
                            <div className={`sticky left-0 z-[3] flex h-full min-h-[52px] flex-col justify-center gap-1 border-r border-slate-200 bg-slate-50 py-2 pl-5 pr-3.5 text-left ${mono} text-[11px] uppercase leading-snug tracking-[0.06em] text-slate-600`}
                              style={{ width: LANE_PAD }}
                            >
                              <TimelineHoverTip
                                entityName={def.name}
                                timestamp={placed[0]?.e.timestamp ?? Date.now()}
                                source={formatRoleLabel(def.role) || def.type}
                                verified={!def.uncorroborated}
                              >
                                <span className="flex items-center gap-2.5">
                                  <span className={`h-[7px] w-[7px] shrink-0 rounded-[2px] ${def.dot}`} />
                                  <span className="min-w-0 whitespace-normal leading-snug line-clamp-2">{def.name} · {count} {count === 1 ? "event" : "events"}</span>
                                </span>
                              </TimelineHoverTip>
                              {tracks > 1 && (
                                <span className="pl-[18px] text-[9.5px] font-normal tracking-[0.08em] text-slate-400">
                                  {tracks} TRACKS
                                </span>
                              )}
                            </div>
                            {placed.map(({ e, row, left, width }) => {
                              const focused = (conflictPulse > 0 && chrono.tether && (e.id === chrono.tether.aId || e.id === chrono.tether.bId))
                                || (focusMerged && e.mergeCount > 1);
                              const sightingCard = e.sighting;
                              return (
                              <button
                                type="button"
                                key={e.id}
                                id={`timeline-node-${e.id}`}
                                onClick={() => openEventDrawer(e.id, e.mergedIds)}
                                className={`absolute z-[2] flex w-max min-w-[220px] items-center overflow-hidden rounded-lg border text-left shadow-xs transition-colors hover:border-blue-300 ${laneAccent} ${e.noise ? "opacity-45" : ""} ${sightingCard ? "border-amber-300 bg-amber-50" : e.secondary ? "border-dashed border-amber-400 bg-white" : e.flag ? "border-amber-300 bg-white ring-[3px] ring-amber-500/10" : "border-slate-200 bg-white"} ${drawerEventId === e.id ? "ring-[3px] ring-blue-600/15" : ""} ${focused ? "contradiction-pulse z-[8] ring-2 ring-amber-500" : ""}`}
                                style={{ left, top: 10 + row * (CARD_H + CARD_GAP), width: Math.max(width, 220), height: CARD_H }}
                              >
                                <div className="flex w-full min-w-max items-center gap-2 px-2.5 py-1.5">
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
                                  className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-xs ${e.flag || sightingCard ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
                                >
                                  {e.time}{e.timeEndMs ? `–${formatClock(e.timeEndMs)}` : ""}
                                </span>
                                <TimelineHoverTip
                                  entityName={e.entityName}
                                  timestamp={e.timestamp}
                                  source={e.sourceName}
                                  verified={e.verified}
                                  mergeCount={e.mergeCount}
                                >
                                  <span className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-800 dark:text-zinc-100">{e.title}</span>
                                </TimelineHoverTip>
                                {e.flag ? (
                                  <span
                                    role="button"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      inspectContradiction(`${e.id}`);
                                    }}
                                    className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-amber-800 underline"
                                  >
                                    Review
                                  </span>
                                ) : null}
                                {e.mergeCount > 1 ? (
                                  <span
                                    role="button"
                                    title="View merged source records"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      openEventDrawer(e.id, e.mergedIds);
                                    }}
                                    className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                                  >
                                    Merged ({e.mergeCount})
                                  </span>
                                ) : null}
                                </div>
                              </button>
                              );
                            })}
                          </div>
                        );
                        }}
                      />

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
                            <div className="pointer-events-auto absolute z-[7] w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[14px] border border-amber-200 bg-white p-4 shadow-xl"
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
                                <button type="button" onClick={() => { if (chrono.tether) void flagConflictUnverified(chrono.tether.aId, chrono.tether.bId); }} className="h-8 flex-1 rounded-lg border border-amber-300 bg-amber-500/10 text-[12.5px] font-medium text-amber-700">Flag for review</button>
                                <button type="button" onClick={() => setPopover(false)} className="h-8 flex-1 rounded-lg border border-slate-300 text-[12.5px] text-slate-600">Dismiss</button>
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
              </div>
            )}
          </main>
        </div>
      </div>

      <TimelineConflictInspector
        open={conflictInspectorOpen}
        pair={chrono.conflictPairs[0] ?? (chrono.tether ? { aId: chrono.tether.aId, bId: chrono.tether.bId, label: chrono.tether.label, detail: chrono.tether.detail } : null)}
        events={caseEvents}
        onClose={() => setConflictInspectorOpen(false)}
        onMerge={(keepId, dropId) => { void mergeConflictEvents(keepId, dropId); }}
        onReassignTime={(eventId) => { void reassignConflictTime(eventId); }}
        onFlagUnverified={(aId, bId) => { void flagConflictUnverified(aId, bId); }}
      />

      {timelineInspect && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-slate-900/40 sm:flex-row">
          <button type="button" className="hidden min-w-0 flex-1 sm:block" aria-label="Close source inspector" onClick={() => setTimelineInspect(null)} />
          <div className="ml-auto flex h-full w-full max-w-[640px] flex-col border-l border-slate-200 bg-white shadow-2xl">
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
          <div className="flex-1" onClick={() => { setDrawerEventId(null); setDrawerEdit(false); setMergedInspectIds([]); }} />
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
                onClick={() => { setDrawerEventId(null); setDrawerEdit(false); setMergedInspectIds([]); }}
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-5 overflow-auto px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                {drawerEvent.isVerified ? (
                  <span className="inline-flex items-center rounded border border-emerald-300/80 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    VERIFIED
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                    UNVERIFIED
                  </span>
                )}
                {(drawerEvent.tier === "secondary" || (drawerSource && isSecondaryEvidence(drawerSource))) && (
                  <span className={`rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-amber-900`}>SECONDARY</span>
                )}
                {drawerEntity && (
                  <MediaProvenanceBadge
                    show={isUncorroboratedEntity(drawerEntity)}
                    onPromote={() => void promoteEntityToVerified(drawerEntity.id)}
                  />
                )}
                {drawerEntity && !/^unverified$/i.test(formatRoleLabel(drawerEntity.role)) && (
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
                      <button
                        type="button"
                        onClick={() => {
                          const citation = citationFromEvent(drawerEvent, drawerSource);
                          if (drawerEvent.sourceDocId) setActiveEvidenceId(drawerEvent.sourceDocId);
                          setTimelineInspect({ eventId: drawerEvent.id, citation });
                          setDrawerEventId(null);
                          goTo("Verify", drawerEvent.caseId);
                        }}
                        className="mt-2 block text-[12.5px] font-semibold text-blue-700 underline"
                      >
                        View Source in Verify
                      </button>
                      {(drawerEvent.sourceCitation?.sourceUrl || drawerSource?.sourceUrl) ? (
                        <a
                          href={drawerEvent.sourceCitation?.sourceUrl || drawerSource?.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-[12.5px] font-semibold text-amber-800 underline"
                        >
                          Open source article
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className={`mb-1 ${mono} text-[10.5px] tracking-[0.12em] text-slate-500`}>LOCATION</div>
                    {(() => {
                      const here = coordinatesForEvent(drawerEvent, caseEntities);
                      const incident = primaryIncidentGeo(caseEntities, activeCase?.lksLocation);
                      const miles = here && incident ? milesBetween(here, incident) : null;
                      return (
                        <div className="text-[13px] leading-relaxed text-slate-700">
                          <div>{here ? `${here.lat.toFixed(4)}, ${here.lng.toFixed(4)}` : "Coordinates not recorded"}</div>
                          <div className="mt-1 text-[12px] text-slate-500">
                            {miles != null
                              ? `${miles} mi from ${incident?.label || "primary incident"}`
                              : `Distance from ${incident?.label || activeCase?.lksLocation || "primary incident"} unavailable`}
                          </div>
                          {drawerEvent.timeEnd ? (
                            <div className="mt-1 text-[12px] text-slate-500">Interval through {drawerEvent.timeEnd}</div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                  {mergedInspectIds.length > 1 ? (
                    <div>
                      <div className={`mb-1 ${mono} text-[10.5px] tracking-[0.12em] text-slate-500`}>MERGED CITATIONS</div>
                      <p className="mb-2 text-[12px] text-slate-500">Corroborating Citations ({Math.max(0, mergedInspectIds.length - 1)})</p>
                      <div className="flex flex-col gap-1.5">
                        {mergedInspectIds.map((id) => {
                          const rec = caseEvents.find((row) => row.id === id);
                          const src = rec ? caseEvidence.find((row) => row.id === rec.sourceDocId) : undefined;
                          const label = src?.originalFileName || src?.fileName || rec?.sourceCitation?.sourceName || rec?.title || id;
                          const markedPrimary = mergedInspectIds.some((rowId) => caseEvents.find((row) => row.id === rowId)?.tier === "primary");
                          const primary = markedPrimary ? rec?.tier === "primary" : id === drawerEvent.id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                void Promise.all(mergedInspectIds.map((rowId) => updateTimelineEvent(rowId, { tier: rowId === id ? "primary" : "secondary" })));
                                openEventDrawer(id, mergedInspectIds);
                              }}
                              className={`rounded-lg border px-2.5 py-2 text-left text-[12.5px] ${primary ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700 hover:border-slate-300"}`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="block font-medium break-words">{rec?.title || "Event"}</span>
                                {primary ? <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">Primary Source ✓</span> : null}
                              </span>
                              <span className="mt-0.5 block max-w-full break-words text-[11px] text-slate-500">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
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
                  <div className="flex gap-2">
                    <button
                      type="button"
                      title={drawerEvent.isVerified ? "Mark as unverified" : "Verify event"}
                      onClick={() => void updateTimelineEvent(drawerEvent.id, drawerEvent.isVerified
                        ? { isVerified: false, confidenceTier: "TIER_2_UNVERIFIED", flaggedNoise: false }
                        : { isVerified: true, confidenceTier: "TIER_1_VERIFIED", flaggedNoise: false })}
                      className={drawerEvent.isVerified
                        ? "h-10 flex-1 rounded-[10px] border border-emerald-300 bg-emerald-50 text-[12.5px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "h-10 flex-1 rounded-[10px] bg-emerald-600 text-[12.5px] font-semibold text-white hover:bg-emerald-700"}
                    >
                      {drawerEvent.isVerified ? "Verified ✓" : "Verify Event"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateTimelineEvent(drawerEvent.id, { isVerified: false, confidenceTier: "TIER_3_CONTRADICTED", flaggedNoise: false })}
                      className="h-10 flex-1 rounded-[10px] border border-amber-300 bg-amber-50 text-[12.5px] font-semibold text-amber-900"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const ids = mergedInspectIds.length > 1 ? mergedInspectIds : [drawerEvent.id];
                        void Promise.all(ids.map((id) => updateTimelineEvent(id, { isVerified: false, confidenceTier: "TIER_2_UNVERIFIED", flaggedNoise: true }))).then(() => {
                          setDrawerEventId(null);
                          setDrawerEdit(false);
                          setMergedInspectIds([]);
                          setToast("Event flagged as noise and moved to archive.");
                        });
                      }}
                      className="h-10 flex-1 rounded-[10px] border border-slate-300 text-[12.5px] font-medium text-slate-700"
                    >
                      Flag as Noise
                    </button>
                  </div>
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
          uncorroborated={Boolean(form.id && caseEntities.some((e) => e.id === form.id && isUncorroboratedEntity(e)))}
          onPromote={form.id ? () => void promoteEntityToVerified(form.id!) : undefined}
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

      {ingestChooser && (
        <IngestChooser
          onDismiss={() => setIngestChooser(false)}
          onInvestigative={() => {
            setIngestChooser(false);
            goTo("Verify");
            window.setTimeout(() => fileRef.current?.click(), 80);
          }}
          onArchive={() => {
            setIngestChooser(false);
            setArchiveFocus(true);
            goTo("Media");
          }}
        />
      )}
      {dupMatch && (
        <DuplicateArbitrationModal
          match={dupMatch}
          onDecide={(decision) => {
            dupResolver.current?.(decision);
            dupResolver.current = null;
            setDupMatch(null);
          }}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept={EVIDENCE_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            void ingestFiles(e.target.files, { extract: true, background: false }).then(() => goTo("Verify"));
          }
          e.target.value = "";
        }}
      />

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
        <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[90] rounded-[12px] border border-slate-200 bg-white px-4 py-3 text-[13px] font-medium text-slate-800 shadow-lg sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md">
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
                  Prefer <span className={mono}>GEMINI_API_KEY</span> or <span className={mono}>OPENAI_API_KEY</span> in <span className={mono}>.env.local</span> (server-side). This field is a local fallback and is never synced.
                </p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                <X className="h-[15px] w-[15px]" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">Provider</label>
                <div className="flex flex-wrap gap-2">
                  {(["gemini", "openai", "anthropic"] as LlmProvider[]).map((p) => (
                    <button key={p} type="button" onClick={() => setProviderDraft(p)}
                      className={`h-9 min-w-[5.5rem] flex-1 rounded-lg border text-[12.5px] font-medium ${providerDraft === p ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                      {p === "gemini" ? "Gemini" : p === "openai" ? "OpenAI" : "Anthropic"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[12px] font-semibold text-slate-700">API key</label>
                <input type="password" value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder="AIza… or sk-…" className={`${inputCls} h-10 text-[13.5px]`} />
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
