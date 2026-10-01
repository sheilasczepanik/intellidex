import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, GitCommitHorizontal, Image as ImageIcon, Inbox, MapPin, Pin, PinOff,
  Plus, ShieldCheck, StickyNote, UserRound,
} from "lucide-react";
import type { CaseRecord, EntityRecord } from "./db";
import type { PersonLeaf } from "./PersonWorkspace";
import { entityAvatarClass, entityInitials, formatRoleLabel } from "./utils/roleBadge";

type CaseNavScreen = "Overview" | "Intake" | "Verify" | "Locations" | "Media" | "Timeline" | "WorkingTheory";

const mono = "font-mono";

const CASE_CHILDREN: { id: CaseNavScreen; icon: typeof Inbox; label: string; badgeKey?: "intake" | "verify" }[] = [
  { id: "Intake", icon: Inbox, label: "Intake", badgeKey: "intake" },
  { id: "Verify", icon: ShieldCheck, label: "Verify", badgeKey: "verify" },
  { id: "Locations", icon: MapPin, label: "Locations & Map" },
  { id: "Media", icon: ImageIcon, label: "Media" },
  { id: "Timeline", icon: GitCommitHorizontal, label: "Timeline" },
  { id: "WorkingTheory", icon: StickyNote, label: "Theory" },
];

const PERSON_LEAVES: { leaf: PersonLeaf; label: string }[] = [
  { leaf: "overview", label: "Overview / Dossier" },
  { leaf: "timeline", label: "Timeline" },
  { leaf: "locations", label: "Locations & Sightings" },
  { leaf: "media", label: "Statements & Media" },
  { leaf: "linked", label: "Linked Entities" },
];

function leafItemClass(on: boolean, locked?: boolean) {
  return `flex h-8 w-full items-center gap-2 rounded-r-[8px] border-l-2 pl-2.5 pr-2 text-left text-[12.5px] transition-colors ${
    locked
      ? "cursor-not-allowed border-transparent text-slate-400 opacity-50"
      : on
        ? "border-blue-600 bg-blue-50 font-semibold text-blue-700"
        : "border-transparent font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
  }`;
}

export default function CaseSidebarTree({
  screen,
  personId,
  personLeaf,
  activeCase,
  people,
  intakeBadge,
  verifyBadge,
  locked,
  onGoCase,
  onGoPerson,
  onPinPerson,
  onUnpinPerson,
}: {
  screen: string;
  personId: string | null;
  personLeaf: PersonLeaf | null;
  activeCase: CaseRecord | null;
  people: EntityRecord[];
  intakeBadge?: number;
  verifyBadge?: number;
  locked: boolean;
  onGoCase: (screen: CaseNavScreen) => void;
  onGoPerson: (id: string, leaf: PersonLeaf) => void;
  onPinPerson: (id: string) => void;
  onUnpinPerson: (id: string) => void;
}) {
  const [caseOpen, setCaseOpen] = useState(true);
  const [openPeople, setOpenPeople] = useState<Record<string, boolean>>({});
  const [pinOpen, setPinOpen] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const pinRef = useRef<HTMLDivElement>(null);

  const subject = activeCase?.subjectName?.trim() || activeCase?.title || "No case selected";
  const pinnedIds = activeCase?.pinnedPersonIds ?? [];
  const pinnedPeople = pinnedIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is EntityRecord => Boolean(p));
  const pinCandidates = useMemo(() => {
    const q = pinQuery.trim().toLowerCase();
    return people
      .filter((p) => p.type === "person" && !pinnedIds.includes(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || formatRoleLabel(p.role).toLowerCase().includes(q));
  }, [people, pinnedIds, pinQuery]);

  useEffect(() => {
    if (personId) setOpenPeople((prev) => ({ ...prev, [personId]: true }));
  }, [personId]);

  useEffect(() => {
    if (!pinOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!pinRef.current?.contains(e.target as Node)) setPinOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pinOpen]);

  const overviewOn = screen === "Overview" && !personId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`mt-3 px-2.5 pb-2 pt-1.5 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>CASE WORKSPACE</div>
      <div className="flex items-center gap-0.5 px-0.5">
        <button
          type="button"
          disabled={locked}
          onClick={() => onGoCase("Overview")}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 py-2 text-left text-[13.5px] transition-colors ${
            locked ? "cursor-not-allowed opacity-40" : overviewOn ? "bg-blue-50 font-semibold text-blue-700" : "font-semibold text-slate-800 hover:bg-slate-50"
          }`}
        >
          <UserRound className="h-4 w-4 shrink-0" />
          <span className="truncate">{subject}</span>
        </button>
        <button
          type="button"
          disabled={locked}
          aria-label={caseOpen ? "Collapse case menu" : "Expand case menu"}
          onClick={() => setCaseOpen((v) => !v)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 disabled:opacity-40"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${caseOpen ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {caseOpen && (
        <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-slate-200 pl-1.5">
          {CASE_CHILDREN.map(({ id, icon: Icon, label, badgeKey }) => {
            const on = screen === id && !personId;
            const badge = badgeKey === "intake" ? intakeBadge : badgeKey === "verify" ? verifyBadge : undefined;
            return (
              <button
                key={id}
                type="button"
                disabled={locked}
                onClick={() => onGoCase(id)}
                className={leafItemClass(on, locked)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">{label}</span>
                {badge != null && badge > 0 ? (
                  <span className={`ml-auto rounded-md px-1.5 py-0.5 ${mono} text-[10px] font-semibold ${id === "Verify" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-1 px-2.5 pb-1.5">
        <Pin className="h-3 w-3 text-slate-400" />
        <div className={`flex-1 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>PINNED PERSONS</div>
        <div className="relative" ref={pinRef}>
          <button
            type="button"
            disabled={locked}
            onClick={() => { setPinOpen((v) => !v); setPinQuery(""); }}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />Pin
          </button>
          {pinOpen && (
            <div className="absolute right-0 z-50 mt-1 w-[220px] rounded-[12px] border border-slate-200 bg-white p-2 shadow-lg">
              <input
                autoFocus
                value={pinQuery}
                onChange={(e) => setPinQuery(e.target.value)}
                placeholder="Search people…"
                className="mb-2 h-8 w-full rounded-md border border-slate-200 px-2 text-[12.5px] outline-none focus:border-blue-500"
              />
              <div className="max-h-48 overflow-auto">
                {pinCandidates.length === 0 ? (
                  <div className="px-1 py-3 text-center text-[12px] text-slate-500">No unpinned people.</div>
                ) : pinCandidates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { onPinPerson(p.id); setPinOpen(false); setOpenPeople((prev) => ({ ...prev, [p.id]: true })); }}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50"
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold ${entityAvatarClass(p.role, "bg-slate-100 text-slate-700", p.notes, p.classification)}`}>
                      {entityInitials(p.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {pinnedPeople.length === 0 ? (
        <p className="px-2.5 pb-2 text-[11.5px] leading-relaxed text-slate-400">
          Pin witnesses, POIs, or detectives to open a personal workspace.
        </p>
      ) : (
        <div className="flex flex-col gap-1 px-0.5 pb-2">
          {pinnedPeople.map((p) => {
            const open = openPeople[p.id] ?? (personId === p.id);
            const here = personId === p.id;
            return (
              <div key={p.id} className="group/pin">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setOpenPeople((prev) => ({ ...prev, [p.id]: !open }))}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 py-1.5 text-left ${here ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${entityAvatarClass(p.role, "bg-slate-100 text-slate-700", p.notes, p.classification)}`}>
                      {entityInitials(p.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] font-semibold ${here ? "text-blue-800" : "text-slate-800"}`}>{p.name}</span>
                      <span className={`block truncate ${mono} text-[9.5px] tracking-[0.04em] text-slate-500`}>{formatRoleLabel(p.role) || "Person"}</span>
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Unpin ${p.name}`}
                    onClick={() => onUnpinPerson(p.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover/pin:opacity-100"
                  >
                    <PinOff className="h-3.5 w-3.5" />
                  </button>
                </div>
                {open && (
                  <div className="ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-1.5">
                    {PERSON_LEAVES.map((item) => (
                      <button
                        key={item.leaf}
                        type="button"
                        onClick={() => onGoPerson(p.id, item.leaf)}
                        className={leafItemClass(here && personLeaf === item.leaf)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
