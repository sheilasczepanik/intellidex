import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Camera, Check, ChevronRight, Clock, FileText, Flag, Image as ImageIcon,
  Link2, MapPin, Mic, Pause, Pencil, Plus, Search, ShieldCheck, Signal, Sparkles,
  Square, StickyNote, Truck, TriangleAlert, User, UserPlus, Users, X, Zap,
} from "lucide-react";
import { formatRoleButtonLabel, formatRoleLabel, PERSON_ROLE_VALUES, roleBadgeClass, roleDisplayClass } from "./utils/roleBadge";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

type Tab = "Briefing" | "Triage" | "Entities";
type Sheet = null | "capture" | "photo" | "voice" | "note" | "entity" | "analysis";
type EntityKind = "People" | "Places" | "Vehicles";
type Status = (typeof PERSON_ROLE_VALUES)[number] | "PRIMARY" | "TRACKED" | "REGISTERED";
type Tone = "amber" | "emerald" | "blue" | "slate";

interface FieldEntity {
  id: string;
  kind: EntityKind;
  name: string;
  status: Status;
  note: string;
  seen: string;
  fresh?: boolean;
}

interface TriageItem {
  id: string;
  kind: "photo" | "audio" | "note";
  title: string;
  sub: string;
  time: string;
  state: "pending" | "linked" | "dismissed";
  conf: number;
  fresh?: boolean;
}

interface Preset {
  id: string;
  label: string;
  kind: "photo" | "audio" | "note";
  caption: string;
  meta: { gps: string; utc: string; hash: string; device: string };
  confidence: number;
  caseName: string;
  entities: { name: string; role: string; kind: EntityKind }[];
  times: string[];
}

/* ------------------------------------------------------------------ */
/* mock data                                                           */
/* ------------------------------------------------------------------ */

const PRESETS: Preset[] = [
  {
    id: "manifest",
    label: "Shipping Manifest Photo",
    kind: "photo",
    caption: "manifest_dock4_0214.jpg",
    meta: { gps: "51.9244 N, 4.4777 E", utc: "2024-02-14T20:47:11Z", hash: "8f2c…a91d", device: "Field unit 04" },
    confidence: 94,
    caseName: "Meridian Freight",
    entities: [
      { name: "Dana Okonkwo", role: "Suspect", kind: "People" },
      { name: "Plate 7XYZ89", role: "Vehicle", kind: "Vehicles" },
      { name: "Dock 4", role: "Place", kind: "Places" },
    ],
    times: ["20:47 capture", "19:30 manifest signed", "21:05 departure slot"],
  },
  {
    id: "audio",
    label: "Audio Observation",
    kind: "audio",
    caption: "voice_memo_0214_2051.m4a",
    meta: { gps: "51.9301 N, 4.4812 E", utc: "2024-02-14T20:51:40Z", hash: "c07b…44e8", device: "Field unit 04" },
    confidence: 88,
    caseName: "Meridian Freight",
    entities: [
      { name: "Marcus Webb", role: "Alibi witness", kind: "People" },
      { name: "Gate 4", role: "Place", kind: "Places" },
    ],
    times: ["20:51 recorded", "20:10 alibi claim referenced"],
  },
  {
    id: "plate",
    label: "Plate Snapshot — Gate 4",
    kind: "photo",
    caption: "anpr_gate4_2051.jpg",
    meta: { gps: "51.9309 N, 4.4820 E", utc: "2024-02-14T20:51:58Z", hash: "3ad9…b120", device: "Field unit 04" },
    confidence: 97,
    caseName: "Meridian Freight",
    entities: [
      { name: "Plate 7XYZ89", role: "Vehicle", kind: "Vehicles" },
      { name: "Gate 4 northbound", role: "Place", kind: "Places" },
    ],
    times: ["20:51 plate read", "20:58 tower ping 42 mi north"],
  },
];

const INITIAL_TRIAGE: TriageItem[] = [
  { id: "t1", kind: "photo", title: "Bonded warehouse entrance", sub: "3 entities extracted · Pier 9", time: "12 min ago", state: "pending", conf: 91 },
  { id: "t2", kind: "audio", title: "Interview fragment — night clerk", sub: "1:42 · transcript ready", time: "38 min ago", state: "pending", conf: 76 },
  { id: "t3", kind: "note", title: "Loading bay unstaffed after 21:00", sub: "Field note · no source attached", time: "1h ago", state: "pending", conf: 64 },
  { id: "t4", kind: "photo", title: "Grey sedan, partial plate K4?-9??", sub: "Linked to CASE-0038", time: "2h ago", state: "linked", conf: 83 },
];

const INITIAL_ENTITIES: FieldEntity[] = [
  { id: "e1", kind: "People", name: "Dana Okonkwo", status: "SUSPECT", note: "Director, Meridian Freight. Seen at Dock 4 twice this week.", seen: "Seen 2h ago" },
  { id: "e2", kind: "People", name: "Marcus Webb", status: "WITNESS", note: "Motel alibi under review — conflicts with toll record.", seen: "Seen yesterday" },
  { id: "e3", kind: "People", name: "A. Brennan", status: "UNVERIFIED", note: "Name in 14 documents, no identity confirmed.", seen: "No sighting" },
  { id: "e4", kind: "Places", name: "Dock 4, Pier 9", status: "PRIMARY", note: "Bonded warehouse. Gate unsecured on last two visits.", seen: "Visited 2h ago" },
  { id: "e5", kind: "Places", name: "Blue Heron Motel", status: "ASSOCIATE", note: "42 mi south of Gate 4. Desk unstaffed 21:00–06:00.", seen: "Visited 14 Feb" },
  { id: "e6", kind: "Vehicles", name: "Volvo FH16 — 7XYZ89", status: "TRACKED", note: "19 ANPR hits. Registered to Meridian Freight.", seen: "Seen 41 min ago" },
  { id: "e7", kind: "Vehicles", name: "Grey sedan", status: "UNVERIFIED", note: "Partial plate from two CCTV stills.", seen: "Seen 14 Feb" },
];

const CASES = [
  { id: "CASE-0038", title: "Meridian Freight", status: "ACTIVE", tone: "amber" as Tone, pct: 91, meta: "9 entities · 4 open contradictions" },
  { id: "CASE-0041", title: "The Harbor Ledger", status: "FIELD", tone: "blue" as Tone, pct: 68, meta: "14 entities · 2 captures today" },
];

/* ------------------------------------------------------------------ */
/* style helpers                                                       */
/* ------------------------------------------------------------------ */

const mono = "font-mono";

const TONE: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  amber: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500" },
  emerald: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", dot: "bg-emerald-600" },
  blue: { text: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200", dot: "bg-indigo-600" },
  slate: { text: "text-slate-500", bg: "bg-slate-100", border: "border-slate-300", dot: "bg-slate-400" },
};

const KIND_ICON: Record<EntityKind, React.ComponentType<{ className?: string }>> = {
  People: User, Places: MapPin, Vehicles: Truck,
};

const ITEM_ICON: Record<TriageItem["kind"], React.ComponentType<{ className?: string }>> = {
  photo: ImageIcon, audio: Mic, note: StickyNote,
};

function Pill({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 ${mono} text-[9.5px] tracking-[0.1em] ${t.text} ${t.bg} ${t.border} ${className}`}>
      {children}
    </span>
  );
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className={`${mono} text-[10px] tracking-[0.18em] text-slate-500`}>{children}</h2>
      {right}
    </div>
  );
}

/* Bottom sheet shell ------------------------------------------------ */

function Sheet({
  open, onClose, title, subtitle, children, footer,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative mx-auto flex max-h-[88vh] w-full max-w-md flex-col rounded-t-3xl border-t border-slate-200 bg-white shadow-[0_-16px_50px_rgba(15,23,42,.16)]">
        <div className="flex justify-center pt-3">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-start gap-3 px-5 pb-4 pt-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-semibold tracking-tight text-slate-900">{title}</h3>
            {subtitle && <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 active:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 pb-6">{footer}</div>}
      </div>
    </div>
  );
}

/* Animated waveform ------------------------------------------------- */

function Waveform({ active, seed = 0 }: { active: boolean; seed?: number }) {
  const bars = 36;
  return (
    <div className="flex h-16 items-center justify-center gap-[3px]">
      {Array.from({ length: bars }, (_, i) => {
        const base = 18 + Math.abs(Math.sin((i + seed) * 1.7)) * 34;
        return (
          <span key={i}
            className={`w-[3px] rounded-full transition-[height,background-color] duration-150 ${active ? "bg-emerald-500" : "bg-slate-300"}`}
            style={{ height: active ? `${12 + Math.abs(Math.sin((i + seed * 3) * 0.9)) * 44}px` : `${base * 0.35}px` }} />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export default function MobileApp() {
  const [tab, setTab] = useState<Tab>("Briefing");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [entities, setEntities] = useState<FieldEntity[]>(INITIAL_ENTITIES);
  const [triage, setTriage] = useState<TriageItem[]>(INITIAL_TRIAGE);
  const [entityFilter, setEntityFilter] = useState<EntityKind>("People");
  const [contradiction, setContradiction] = useState<"open" | "flagged" | "dismissed">("open");
  const [toast, setToast] = useState<string | null>(null);

  /* analysis flow */
  const [preset, setPreset] = useState<Preset | null>(null);
  const [progress, setProgress] = useState(0);
  const analysing = preset != null && progress < 100;

  /* voice memo */
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [waveSeed, setWaveSeed] = useState(0);

  /* quick note */
  const [noteText, setNoteText] = useState("");

  /* entity sheet */
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<EntityKind>("People");
  const [newStatus, setNewStatus] = useState<Status>("UNVERIFIED");
  const [newNote, setNewNote] = useState("");
  const [dictating, setDictating] = useState(false);

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2200); };

  /* analysis progress ticker */
  useEffect(() => {
    if (!preset || progress >= 100) return;
    const t = window.setTimeout(() => setProgress((p) => Math.min(100, p + 7 + Math.random() * 11)), 130);
    return () => window.clearTimeout(t);
  }, [preset, progress]);

  /* recording timer (caps at 10s) */
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => {
      setWaveSeed((s) => s + 1);
      setSeconds((s) => {
        if (s + 1 >= 10) { setRecording(false); return 10; }
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  /* auto-transcribe simulation in entity sheet */
  useEffect(() => {
    if (!dictating) return;
    const phrases = [
      "Observed at the east gate, ",
      "wearing a high-vis jacket, ",
      "left in a white van at 20:14.",
    ];
    let i = 0;
    const t = window.setInterval(() => {
      if (i >= phrases.length) { setDictating(false); window.clearInterval(t); return; }
      setNewNote((n) => n + phrases[i]);
      i += 1;
    }, 900);
    return () => window.clearInterval(t);
  }, [dictating]);

  const startAnalysis = (p: Preset) => { setPreset(p); setProgress(0); setSheet("analysis"); };

  const confirmMatch = () => {
    if (!preset) return;
    setTriage((t) => [
      { id: `n${Date.now()}`, kind: preset.kind, title: preset.caption, sub: `Linked to ${preset.caseName} · ${preset.entities.length} entities`, time: "just now", state: "linked", conf: preset.confidence, fresh: true },
      ...t,
    ]);
    setEntities((prev) => {
      const existing = new Set(prev.map((e) => e.name));
      const added = preset.entities
        .filter((e) => !existing.has(e.name))
        .map((e, i) => ({
          id: `ai${Date.now()}${i}`, kind: e.kind, name: e.name,
          status: (e.role === "Subject" ? "SUSPECT" : "UNVERIFIED") as Status,
          note: `Extracted from ${preset.caption}.`, seen: "Just now", fresh: true,
        }));
      return [...added, ...prev];
    });
    setSheet(null); setPreset(null); setProgress(0);
    setTab("Triage");
    flash("Linked to Meridian Freight");
  };

  const saveNote = () => {
    if (!noteText.trim()) return;
    setTriage((t) => [
      { id: `n${Date.now()}`, kind: "note", title: noteText.trim().slice(0, 48), sub: "Field note · awaiting source", time: "just now", state: "pending", conf: 60, fresh: true },
      ...t,
    ]);
    setNoteText(""); setSheet(null); setTab("Triage"); flash("Note added to triage");
  };

  const saveVoice = () => {
    setTriage((t) => [
      { id: `v${Date.now()}`, kind: "audio", title: `voice_memo_${String(seconds).padStart(2, "0")}s.m4a`, sub: "Transcript queued · GPS stamped", time: "just now", state: "pending", conf: 72, fresh: true },
      ...t,
    ]);
    setSeconds(0); setRecording(false); setSheet(null); setTab("Triage"); flash("Voice memo staged");
  };

  const saveEntity = () => {
    if (!newName.trim()) return;
    setEntities((prev) => [
      { id: `m${Date.now()}`, kind: newKind, name: newName.trim(), status: newStatus, note: newNote.trim() || "No observation recorded.", seen: "Just now", fresh: true },
      ...prev,
    ]);
    setNewName(""); setNewNote(""); setNewStatus("UNVERIFIED"); setDictating(false);
    setSheet(null); setTab("Entities"); setEntityFilter(newKind); flash(`${newKind.slice(0, -1)} added`);
  };

  const pendingCount = triage.filter((t) => t.state === "pending").length;
  const visibleEntities = useMemo(() => entities.filter((e) => e.kind === entityFilter), [entities, entityFilter]);

  /* ---------------------------------------------------------------- */

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-24 font-sans text-slate-900 antialiased">

      {/* status bar */}
      <div className={`flex items-center justify-between px-5 pb-1 pt-3 ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>
        <span>20:53</span>
        <div className="flex items-center gap-2">
          <Signal className="h-3 w-3" />
          <span>FIELD UNIT 04</span>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        </div>
      </div>

      {/* header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-5 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-indigo-50 ring-1 ring-indigo-200">
            <div className="h-2.5 w-2.5 rounded-[3px] bg-indigo-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[15px] font-bold tracking-widest text-slate-900">INTELLIDEX Field</div>
            <div className={`${mono} text-[10px] tracking-[0.12em] text-slate-500`}>OFFLINE VAULT · 3 UNSYNCED</div>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 active:bg-slate-100">
            <Search className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ---------------- BRIEFING ---------------- */}
      {tab === "Briefing" && (
        <div className="space-y-7 px-5 pt-5">
          <section>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-pretty">
              One contradiction needs you in the field.
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500 text-pretty">
              Captures stay on this handset until you reach a sync point. Triage queue holds {pendingCount} items.
            </p>
          </section>

          {/* contradiction card */}
          <section>
            <SectionLabel right={<Pill tone="amber">C-02</Pill>}>CONTRADICTION ALERT</SectionLabel>
            <div className={`overflow-hidden rounded-2xl border ${contradiction === "open" ? "border-amber-300" : "border-slate-200"} bg-white`}>
              <div className="border-b border-slate-200 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Pill tone="slate">LANE 2</Pill>
                  <span className={`${mono} text-[11px] text-slate-500`}>STATEMENT</span>
                </div>
                <div className="text-[15px] font-medium">Motel Alibi</div>
                <div className="mt-1 flex items-center gap-2 text-[12.5px] text-slate-500">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />20:10 · Room 214, Blue Heron Motel
                </div>
              </div>

              <div className="relative flex items-center gap-3 bg-amber-50 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-200">
                  <TriangleAlert className="h-3.5 w-3.5 text-amber-700" />
                </div>
                <div className="min-w-0 text-[12px] leading-snug text-amber-900 text-pretty">
                  <span className="font-semibold text-amber-700">Contradiction:</span> drive time 58 min, observed gap only 41 min.
                </div>
              </div>

              <div className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Pill tone="slate">LANE 3</Pill>
                  <span className={`${mono} text-[11px] text-slate-500`}>FIELD PHOTO</span>
                </div>
                <div className="text-[15px] font-medium">Gate 4 Field Photo</div>
                <div className="mt-1 flex items-center gap-2 text-[12.5px] text-slate-500">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />20:51 · northbound plate read, 42 mi north
                </div>
              </div>

              <div className="flex gap-2 border-t border-slate-200 p-3">
                {contradiction === "open" ? (
                  <>
                    <button onClick={() => { setContradiction("flagged"); flash("Contradiction flagged for review"); }}
                      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 text-[13.5px] font-semibold text-amber-950 active:bg-amber-400">
                      <Flag className="h-4 w-4" />Flag Contradiction
                    </button>
                    <button onClick={() => { setContradiction("dismissed"); flash("Dismissed"); }}
                      className="flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 text-[13.5px] font-medium text-slate-600 active:bg-slate-100">
                      Dismiss
                    </button>
                  </>
                ) : (
                  <div className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl ${contradiction === "flagged" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"} ${mono} text-[11px] tracking-[0.1em]`}>
                    {contradiction === "flagged" ? <><Flag className="h-3.5 w-3.5" />FLAGGED FOR REVIEW</> : <><Check className="h-3.5 w-3.5" />DISMISSED</>}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* active cases */}
          <section>
            <SectionLabel right={<span className={`${mono} text-[10px] text-slate-400`}>2 ASSIGNED</span>}>ACTIVE CASES</SectionLabel>
            <div className="space-y-2.5">
              {CASES.map((c) => (
                <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4 active:border-slate-300">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className={`mb-1 ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>{c.id}</div>
                      <div className="text-[16px] font-semibold tracking-tight">{c.title}</div>
                    </div>
                    <Pill tone={c.tone}>{c.status}</Pill>
                  </div>
                  <div className="mb-3 text-[12.5px] text-slate-500">{c.meta}</div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full rounded-full ${TONE[c.tone].dot}`} style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* quick capture presets */}
          <section>
            <SectionLabel>SIMULATE A CAPTURE</SectionLabel>
            <div className="space-y-2">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => startAnalysis(p)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left active:border-indigo-300">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-indigo-600">
                    {p.kind === "audio" ? <Mic className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{p.label}</div>
                    <div className={`truncate ${mono} text-[10.5px] text-slate-500`}>{p.caption}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ---------------- TRIAGE ---------------- */}
      {tab === "Triage" && (
        <div className="px-5 pt-5">
          <h1 className="text-[22px] font-semibold tracking-tight">Evidence stream</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 text-pretty">
            Everything captured in the field, newest first. Resolve before you sync.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { k: "PENDING", v: pendingCount, tone: "amber" as Tone },
              { k: "LINKED", v: triage.filter((t) => t.state === "linked").length, tone: "emerald" as Tone },
              { k: "DROPPED", v: triage.filter((t) => t.state === "dismissed").length, tone: "slate" as Tone },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div className={`text-[19px] font-semibold ${TONE[s.tone].text}`}>{s.v}</div>
                <div className={`${mono} text-[9.5px] tracking-[0.12em] text-slate-500`}>{s.k}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-2.5">
            {triage.map((item) => {
              const Icon = ITEM_ICON[item.kind];
              const tone: Tone = item.state === "linked" ? "emerald" : item.state === "dismissed" ? "slate" : "amber";
              return (
                <div key={item.id}
                  className={`rounded-2xl border bg-white p-4 transition-colors ${item.fresh ? "border-emerald-300" : "border-slate-200"} ${item.state === "dismissed" ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium">{item.title}</span>
                        <Pill tone={tone}>{item.state.toUpperCase()}</Pill>
                      </div>
                      <div className="truncate text-[12px] text-slate-500">{item.sub}</div>
                      <div className={`mt-2 flex items-center gap-2 ${mono} text-[10px] text-slate-500`}>
                        <span>{item.time}</span><span className="text-slate-300">·</span>
                        <span>CONF {item.conf}%</span>
                      </div>
                    </div>
                  </div>

                  {item.state === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => { setTriage((t) => t.map((x) => x.id === item.id ? { ...x, state: "linked" } : x)); flash("Linked to case"); }}
                        className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-[13px] font-semibold text-emerald-950 active:bg-emerald-500">
                        <Check className="h-4 w-4" />Confirm & Link
                      </button>
                      <button onClick={() => setTriage((t) => t.map((x) => x.id === item.id ? { ...x, state: "dismissed" } : x))}
                        className="flex h-10 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-500 active:bg-slate-100">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------- ENTITIES ---------------- */}
      {tab === "Entities" && (
        <div className="px-5 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Rolodex</h1>
              <p className="mt-1.5 text-[13px] text-slate-500">{entities.length} records on this device</p>
            </div>
            <button onClick={() => setSheet("entity")}
              className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-3.5 text-[13px] font-semibold text-white active:bg-indigo-700">
              <Plus className="h-4 w-4" />Add
            </button>
          </div>

          <div className="mt-4 flex gap-1.5 rounded-xl border border-slate-200 bg-white p-1">
            {(["People", "Places", "Vehicles"] as EntityKind[]).map((k) => {
              const on = entityFilter === k;
              const Icon = KIND_ICON[k];
              return (
                <button key={k} onClick={() => setEntityFilter(k)}
                  className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg text-[12.5px] transition-colors ${on ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-500"}`}>
                  <Icon className="h-3.5 w-3.5" />{k}
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-2.5">
            {visibleEntities.map((e) => {
              const Icon = KIND_ICON[e.kind];
              return (
                <div key={e.id} className={`flex gap-3 rounded-2xl border bg-white p-4 ${e.fresh ? "border-emerald-300" : "border-slate-200"}`}>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-500">
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium">{e.name}</span>
                      <span className={`inline-flex max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.06em] whitespace-nowrap ${roleDisplayClass(e.status, "") || "border-slate-200 bg-slate-50 text-slate-500"}`}>
                        {formatRoleLabel(e.status) || e.status}
                      </span>
                    </div>
                    <p className="text-[12px] leading-relaxed text-slate-500 text-pretty">{e.note}</p>
                    <div className={`mt-2 ${mono} text-[10px] tracking-[0.08em] text-slate-400`}>{e.seen.toUpperCase()}</div>
                  </div>
                  <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
                </div>
              );
            })}
            {visibleEntities.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-[13px] text-slate-500">
                No {entityFilter.toLowerCase()} recorded yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- toast ---------------- */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 z-[60] w-[min(22rem,88vw)] -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-[12.5px] text-emerald-700 backdrop-blur">
          {toast}
        </div>
      )}

      {/* ---------------- bottom nav ---------------- */}
      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="relative grid grid-cols-[1fr_1fr_auto_1fr_1fr] items-end px-3 pb-5 pt-2">
          <NavButton label="Briefing" icon={ShieldCheck} active={tab === "Briefing"} onClick={() => setTab("Briefing")} />
          <NavButton label="Triage" icon={Zap} active={tab === "Triage"} onClick={() => setTab("Triage")} badge={pendingCount} />
          <div className="flex w-20 justify-center">
            <button onClick={() => setSheet("capture")} aria-label="Capture"
              className="relative -mt-9 flex h-16 w-16 flex-col items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-[0_10px_30px_rgba(79,70,229,.30)] active:bg-indigo-700">
              <span className="absolute inset-0 animate-ping rounded-2xl bg-indigo-500/20" />
              <Plus className="relative h-6 w-6" strokeWidth={2.5} />
              <span className={`relative ${mono} text-[9px] font-bold tracking-[0.1em]`}>CAPTURE</span>
            </button>
          </div>
          <NavButton label="Entities" icon={Users} active={tab === "Entities"} onClick={() => setTab("Entities")} />
          <NavButton label="Cases" icon={FileText} active={false} onClick={() => setTab("Briefing")} />
        </div>
      </nav>

      {/* ---------------- capture action sheet ---------------- */}
      <Sheet open={sheet === "capture"} onClose={() => setSheet(null)}
        title="Capture" subtitle="Everything is GPS-stamped and hashed on this device before it moves.">
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { id: "photo" as Sheet, icon: Camera, label: "Photo / Camera", sub: "Document, plate, entrance" },
            { id: "voice" as Sheet, icon: Mic, label: "Voice Memo", sub: "Auto-transcribed" },
            { id: "note" as Sheet, icon: StickyNote, label: "Quick Note", sub: "Field observation" },
            { id: "entity" as Sheet, icon: UserPlus, label: "Add Entity", sub: "Person, place, vehicle" },
          ].map((t) => (
            <button key={t.label} onClick={() => setSheet(t.id)}
              className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left active:border-indigo-300">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <t.icon className="h-[18px] w-[18px]" />
              </div>
              <div>
                <div className="text-[13.5px] font-semibold">{t.label}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{t.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </Sheet>

      {/* ---------------- photo sheet ---------------- */}
      <Sheet open={sheet === "photo"} onClose={() => setSheet(null)}
        title="Camera" subtitle="Pick a simulated capture — analysis runs on-device.">
        <div className="mb-4 flex aspect-[4/3] items-center justify-center rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_50%_40%,#f8fafc,#eef2f7)]">
          <div className="text-center">
            <Camera className="mx-auto mb-2 h-7 w-7 text-slate-400" />
            <div className={`${mono} text-[10px] tracking-[0.14em] text-slate-400`}>VIEWFINDER · f/1.8 · ISO 800</div>
          </div>
        </div>
        <div className="space-y-2">
          {PRESETS.filter((p) => p.kind === "photo").map((p) => (
            <button key={p.id} onClick={() => startAnalysis(p)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-left active:border-indigo-300">
              <ImageIcon className="h-4 w-4 shrink-0 text-indigo-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{p.label}</div>
                <div className={`truncate ${mono} text-[10px] text-slate-500`}>{p.caption}</div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          ))}
        </div>
      </Sheet>

      {/* ---------------- voice memo sheet ---------------- */}
      <Sheet open={sheet === "voice"} onClose={() => { setSheet(null); setRecording(false); setSeconds(0); }}
        title="Voice memo" subtitle="Ten-second field note, transcribed on device."
        footer={
          <div className="flex gap-2">
            <button onClick={() => { setRecording((r) => !r); if (seconds >= 10) setSeconds(0); }}
              className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold ${recording ? "bg-slate-200 text-slate-700" : "bg-emerald-600 text-white active:bg-emerald-700"}`}>
              {recording ? <><Pause className="h-4 w-4" />Pause</> : <><Mic className="h-4 w-4" />{seconds > 0 ? "Resume" : "Record"}</>}
            </button>
            <button onClick={saveVoice} disabled={seconds === 0}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[14px] font-semibold text-white disabled:opacity-40 active:bg-indigo-700">
              <Square className="h-3.5 w-3.5" />Save memo
            </button>
          </div>
        }>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${recording ? "animate-pulse bg-red-500" : "bg-slate-300"}`} />
              <span className={`${mono} text-[10.5px] tracking-[0.12em] ${recording ? "text-red-600" : "text-slate-500"}`}>
                {recording ? "RECORDING" : seconds >= 10 ? "LIMIT REACHED" : "STANDBY"}
              </span>
            </div>
            <span className={`${mono} text-[22px] tabular-nums ${recording ? "text-slate-900" : "text-slate-500"}`}>
              0:{String(seconds).padStart(2, "0")}
              <span className="text-[13px] text-slate-400"> / 0:10</span>
            </span>
          </div>
          <Waveform active={recording} seed={waveSeed} />
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-1000" style={{ width: `${seconds * 10}%` }} />
          </div>
        </div>
        <div className={`mt-4 grid grid-cols-2 gap-2 ${mono} text-[10px] text-slate-500`}>
          <div className="rounded-lg border border-slate-200 px-3 py-2">GPS 51.9301 N</div>
          <div className="rounded-lg border border-slate-200 px-3 py-2">UTC 20:51:40Z</div>
        </div>
      </Sheet>

      {/* ---------------- quick note sheet ---------------- */}
      <Sheet open={sheet === "note"} onClose={() => setSheet(null)}
        title="Quick note" subtitle="Short observation, stamped with your current position."
        footer={
          <button onClick={saveNote} disabled={!noteText.trim()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[14px] font-semibold text-white disabled:opacity-40 active:bg-indigo-700">
            <Check className="h-4 w-4" />Save to triage
          </button>
        }>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={5}
          placeholder="Gate unsecured, no personnel on site at 20:53…"
          className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[14px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500" />
        <div className="mt-3 flex flex-wrap gap-2">
          {["Gate unsecured", "No personnel", "Vehicle present", "Follow up"].map((chip) => (
            <button key={chip} onClick={() => setNoteText((n) => (n ? `${n} ${chip}. ` : `${chip}. `))}
              className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 ${mono} text-[10.5px] tracking-[0.06em] text-slate-500 active:border-indigo-300`}>
              + {chip.toUpperCase()}
            </button>
          ))}
        </div>
      </Sheet>

      {/* ---------------- rapid entity sheet ---------------- */}
      <Sheet open={sheet === "entity"} onClose={() => setSheet(null)}
        title="Add entity" subtitle="Field record — refine it later on the desktop workspace."
        footer={
          <button onClick={saveEntity} disabled={!newName.trim()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-[14px] font-semibold text-white disabled:opacity-40 active:bg-indigo-700">
            <Check className="h-4 w-4" />Save entity
          </button>
        }>
        <div className="flex gap-3">
          <button className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-slate-500 active:border-indigo-500">
            <Camera className="h-5 w-5" />
            <span className={`${mono} text-[8.5px] tracking-[0.1em]`}>PHOTO</span>
          </button>
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-[11.5px] font-semibold text-slate-500">Full name / alias</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Halvard Sund"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500" />
            <div className="mt-2 flex gap-1.5">
              {(["People", "Places", "Vehicles"] as EntityKind[]).map((k) => (
                <button key={k} onClick={() => { setNewKind(k); setNewStatus("UNVERIFIED"); }}
                  className={`flex-1 rounded-lg border px-2 py-1.5 ${mono} text-[9.5px] tracking-[0.08em] ${newKind === k ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-500"}`}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-[11.5px] font-semibold text-slate-500">Status</label>
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {(newKind === "People"
              ? [...PERSON_ROLE_VALUES]
              : newKind === "Places"
                ? (["PRIMARY", "REGISTERED", "UNVERIFIED"] as Status[])
                : (["TRACKED", "REGISTERED", "UNVERIFIED"] as Status[])
            ).map((s) => {
              const on = newStatus === s;
              return (
                <button key={s} onClick={() => setNewStatus(s)}
                  className={`inline-flex h-9 max-w-full shrink-0 items-center gap-1 rounded-lg px-2 ${mono} text-[9px] tracking-[0.06em] whitespace-nowrap transition-all ${roleBadgeClass(s, on)}`}>
                  {on ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                  {formatRoleButtonLabel(s)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[11.5px] font-semibold text-slate-500">Observations</label>
            <button onClick={() => setDictating((d) => !d)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${mono} text-[9.5px] tracking-[0.08em] ${dictating ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 text-slate-500"}`}>
              <Mic className="h-3 w-3" />{dictating ? "LISTENING…" : "DICTATE"}
            </button>
          </div>
          <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={4}
            placeholder="Tap dictate to speak, or type what you saw."
            className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-[13.5px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500" />
          {dictating && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-red-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />Transcribing on device…
            </div>
          )}
        </div>
      </Sheet>

      {/* ---------------- AI analysis sheet ---------------- */}
      <Sheet open={sheet === "analysis" && preset != null} onClose={() => { setSheet(null); setPreset(null); setProgress(0); }}
        title={analysing ? "Analyzing asset with AI…" : "Smart extraction"}
        subtitle={preset?.caption}
        footer={!analysing && preset ? (
          <div className="flex gap-2">
            <button onClick={confirmMatch}
              className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-emerald-500 text-[13.5px] font-semibold text-emerald-950 active:bg-emerald-500">
              <Check className="h-4 w-4" />Confirm & Link to Case
            </button>
            <button onClick={() => { setSheet("entity"); flash("Adjust the match manually"); }}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 text-[13.5px] font-medium text-slate-600 active:bg-slate-100">
              <Pencil className="h-4 w-4" />Edit Match
            </button>
          </div>
        ) : undefined}>
        {preset && (
          <>
            {/* progress */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className={`h-4 w-4 ${analysing ? "animate-pulse text-indigo-600" : "text-emerald-600"}`} />
                <span className={`${mono} text-[10.5px] tracking-[0.12em] ${analysing ? "text-indigo-600" : "text-emerald-600"}`}>
                  {analysing ? "EXTRACTING ENTITIES…" : "ANALYSIS COMPLETE"}
                </span>
                <div className="flex-1" />
                <span className={`${mono} text-[11px] tabular-nums text-slate-500`}>{Math.round(progress)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full transition-all duration-150 ${analysing ? "bg-indigo-600" : "bg-emerald-500"}`} style={{ width: `${progress}%` }} />
              </div>
              <div className={`mt-3 grid grid-cols-2 gap-1.5 ${mono} text-[9.5px] tracking-[0.06em] text-slate-500`}>
                <div className="rounded-lg border border-slate-200 px-2.5 py-1.5">GPS {preset.meta.gps}</div>
                <div className="rounded-lg border border-slate-200 px-2.5 py-1.5">UTC {preset.meta.utc.slice(11, 19)}Z</div>
                <div className="rounded-lg border border-slate-200 px-2.5 py-1.5">SHA-256 {preset.meta.hash}</div>
                <div className="rounded-lg border border-slate-200 px-2.5 py-1.5">{preset.meta.device.toUpperCase()}</div>
              </div>
            </div>

            {/* suggestion */}
            {!analysing && (
              <div className="mt-3 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60">
                <div className="flex items-center gap-3 border-b border-emerald-200 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <Link2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-emerald-800">
                      {preset.confidence}% match to active case
                    </div>
                    <div className={`${mono} text-[10.5px] tracking-[0.08em] text-emerald-700/70`}>{preset.caseName.toUpperCase()}</div>
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className={`mb-2 ${mono} text-[9.5px] tracking-[0.14em] text-slate-500`}>EXTRACTED ENTITIES</div>
                  <div className="space-y-1.5">
                    {preset.entities.map((e) => {
                      const Icon = KIND_ICON[e.kind];
                      return (
                        <div key={e.name} className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">{e.name}</span>
                          <Pill tone="slate">{e.role.toUpperCase()}</Pill>
                        </div>
                      );
                    })}
                  </div>

                  <div className={`mb-2 mt-4 ${mono} text-[9.5px] tracking-[0.14em] text-slate-500`}>DATES / TIMES</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preset.times.map((t) => (
                      <span key={t} className={`rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 ${mono} text-[10px] text-slate-500`}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NavButton({
  label, icon: Icon, active, onClick, badge, compact,
}: {
  label: string; icon: React.ComponentType<{ className?: string }>;
  active: boolean; onClick: () => void; badge?: number; compact?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={`relative flex flex-col items-center gap-1 ${compact ? "py-0.5" : "py-1.5"} transition-colors ${active ? "text-indigo-600" : "text-slate-500"}`}>
      <div className="relative">
        <Icon className="h-[19px] w-[19px]" />
        {badge != null && badge > 0 && (
          <span className={`absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 ${mono} text-[9px] font-bold text-white`}>
            {badge}
          </span>
        )}
      </div>
      <span className="text-[10.5px] font-medium tracking-tight">{label}</span>
      {active && <span className="absolute -bottom-0.5 h-0.5 w-5 rounded-full bg-indigo-600" />}
    </button>
  );
}
