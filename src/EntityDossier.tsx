import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pin, Search } from "lucide-react";
import type { ComponentType } from "react";
import { getCategoryColor, resolveSemanticCategory, type CategoryColorInput } from "./utils/categoryColors";
import { formatRoleLabel, roleDisplayClass, entityAvatarClass, entityInitials } from "./utils/roleBadge";
import MediaProvenanceBadge from "./MediaProvenanceBadge";
import type { EntityType } from "./types";

const mono = "font-mono";
const CAP = 5;

export type DossierLane = {
  def: {
    id: string;
    name: string;
    role: string;
    note: string;
    type?: EntityType | string;
    category: CategoryColorInput;
    dot: string;
    uncorroborated?: boolean;
    entityId?: string;
  };
  count: number;
};

type GroupId = "persons" | "places" | "vehicles" | "phones";
type Pill = "all" | "persons" | "places" | "evidence";
type EntityBucket = "Person" | "Vehicle" | "Location" | "Evidence" | "Organization";

const ENTITY_BUCKETS: EntityBucket[] = ["Person", "Vehicle", "Location", "Evidence", "Organization"];

function bucketFor(lane: DossierLane): EntityBucket {
  const classification = String(lane.def.category.category || "").toUpperCase();
  const type = String(lane.def.type || "").toLowerCase();
  if (classification === "ORGANIZATION") return "Organization";
  if (classification === "VEHICLE" || type === "vehicle") return "Vehicle";
  if (classification === "LOCATION" || type === "place" || type === "location") return "Location";
  if (classification === "EVIDENCE" || type === "exhibit" || type === "evidence") return "Evidence";
  return "Person";
}

const GROUPS: { id: GroupId; title: string }[] = [
  { id: "persons", title: "Key Persons" },
  { id: "places", title: "Locations & Perimeters" },
  { id: "vehicles", title: "Vehicles & Assets" },
  { id: "phones", title: "Phone & Transmission Logs" },
];

function groupFor(lane: DossierLane): GroupId {
  const bucket = bucketFor(lane);
  const type = String(lane.def.type || "").toLowerCase();
  const blob = `${lane.def.name} ${lane.def.role} ${lane.def.note}`.toLowerCase();
  if (bucket === "Vehicle" || bucket === "Evidence") return "vehicles";
  if (bucket === "Organization" || bucket === "Person" || type === "person") return "persons";
  if (bucket === "Location" || type === "place" || type === "location") return "places";
  if (type === "phone" || type === "digital" || /call|phone|transmission|tower|handset/.test(blob)) return "phones";
  return "vehicles";
}

type Props = {
  open: boolean;
  selected: string | null;
  lanes: DossierLane[];
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  onPromoteEntity?: (id: string) => void;
  ToggleIcon: ComponentType<{ className?: string }>;
  pinnedIds?: string[];
  onTogglePin?: (id: string) => void;
  onRecategorize?: (id: string, bucket: EntityBucket) => void;
};

export default function EntityDossier({ open, selected, lanes, onToggle, onSelect, onPromoteEntity, ToggleIcon, pinnedIds, onTogglePin, onRecategorize }: Props) {
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<Pill>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lanes.filter((lane) => {
      const group = groupFor(lane);
      if (pill === "persons" && group !== "persons") return false;
      if (pill === "places" && group !== "places") return false;
      if (pill === "evidence" && (group === "persons" || group === "places")) return false;
      if (!q) return true;
      return `${lane.def.name} ${lane.def.role} ${lane.def.note}`.toLowerCase().includes(q);
    });
  }, [lanes, query, pill]);

  const grouped = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      items: filtered.filter((lane) => groupFor(lane) === group.id),
    })).filter((group) => group.items.length > 0);
  }, [filtered]);

  const syncEdges = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      top: scrollTop > 4,
      bottom: scrollTop + clientHeight < scrollHeight - 4,
    });
  };

  useLayoutEffect(() => {
    syncEdges();
  }, [filtered, collapsed, expanded, open]);

  return (
    <aside className={`flex shrink-0 flex-col overflow-hidden border-slate-200 bg-slate-50/60 transition-[width] duration-200 max-lg:absolute max-lg:z-20 max-lg:h-full ${open ? "w-[min(288px,86vw)] border-r" : "w-0 border-0 max-lg:pointer-events-none lg:w-[58px] lg:border-r"}`}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2.5 border-b border-slate-200 pl-[18px] pr-3.5">
        {open && (
          <span className={`whitespace-nowrap ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>ENTITY DOSSIER</span>
        )}
        <button onClick={onToggle}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">
          <ToggleIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-2 border-b border-slate-200 px-3.5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search entities..."
                className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-2 text-[12.5px] outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {([
                ["all", "All"],
                ["persons", "Persons"],
                ["places", "Locations"],
                ["evidence", "Evidence"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPill(id)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pill === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={syncEdges}
              className="dossier-scroll flex h-full flex-col gap-3 overflow-y-auto px-3.5 pb-6 pt-3"
            >
            {grouped.map((group) => {
              const shut = collapsed[group.id];
              const showAll = expanded[group.id];
              const visible = showAll ? group.items : group.items.slice(0, CAP);
              const extra = group.items.length - visible.length;
              return (
                <section key={group.id}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                    className="mb-1.5 flex w-full items-center gap-1.5 text-left"
                  >
                    {shut ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                    <span className={`${mono} text-[10.5px] tracking-[0.1em] text-slate-500`}>{group.title.toUpperCase()}</span>
                    <span className={`${mono} text-[10px] text-slate-400`}>{group.items.length}</span>
                  </button>
                  {!shut && (
                    <div className="flex flex-col gap-1.5">
                      {visible.map(({ def, count }) => {
                        const on = selected === def.id;
                        const semantic = resolveSemanticCategory(def.category);
                        return (
                          <div key={def.id} onClick={() => onSelect(on ? null : def.id)}
                            className={`cursor-pointer rounded-[10px] border p-3 transition-colors ${on ? "border-slate-300 bg-white" : "border-transparent hover:bg-slate-100/70"}`}>
                            <div className="mb-2 flex items-center gap-2.5">
                              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${entityAvatarClass(def.role, getCategoryColor(semantic, "badge"), def.note)}`}>
                                {entityInitials(def.name)}
                              </span>
                              <span className="min-w-0 whitespace-normal text-[13.5px] font-medium leading-snug line-clamp-2">{def.name}</span>
                              {def.entityId && onTogglePin ? (
                                <button
                                  type="button"
                                  aria-label={(pinnedIds ?? []).includes(def.entityId) ? "Unpin person" : "Pin person"}
                                  onClick={(e) => { e.stopPropagation(); onTogglePin(def.entityId!); }}
                                  className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${(pinnedIds ?? []).includes(def.entityId) ? "text-blue-700" : "text-slate-400 hover:bg-slate-100"}`}
                                >
                                  <Pin className={`h-3.5 w-3.5 ${(pinnedIds ?? []).includes(def.entityId) ? "fill-blue-600" : ""}`} />
                                </button>
                              ) : null}
                            </div>
                            <div className="mb-1.5 flex items-center gap-2">
                              <span className={`min-w-0 ${mono} text-[10.5px] tracking-[0.06em] text-slate-500`}>{def.role ? formatRoleLabel(def.role) : "ENTITY"}</span>
                              {on && def.entityId && onRecategorize ? (
                                <select
                                  aria-label="Entity category"
                                  value={bucketFor({ def, count })}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => onRecategorize(def.entityId!, e.target.value as EntityBucket)}
                                  className="ml-auto h-6 max-w-[118px] rounded-md border border-slate-200 bg-white px-1 text-[11px] text-slate-700"
                                >
                                  {ENTITY_BUCKETS.map((bucket) => <option key={bucket} value={bucket}>{bucket}</option>)}
                                </select>
                              ) : null}
                            </div>
                            <div className="text-[12px] leading-relaxed text-slate-500 text-pretty line-clamp-2">{def.note || "No notes recorded."}</div>
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-md border px-[7px] py-0.5 ${mono} text-[10px] ${getCategoryColor(semantic, "badge")}`}>
                                {count} {count === 1 ? "EVENT" : "EVENTS"}
                              </span>
                              <span className={`inline-flex max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${roleDisplayClass(def.role, getCategoryColor(semantic, "badge"))}`}>
                                {formatRoleLabel(def.role || "OPEN")}
                              </span>
                              <MediaProvenanceBadge
                                show={def.uncorroborated}
                                onPromote={def.entityId && onPromoteEntity ? () => onPromoteEntity(def.entityId!) : undefined}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {extra > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [group.id]: true }))}
                          className="rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-blue-700 hover:bg-blue-50"
                        >
                          + Show {extra} more
                        </button>
                      ) : null}
                    </div>
                  )}
                </section>
              );
            })}
            {filtered.length === 0 && (
              <div className="rounded-[10px] border border-dashed border-slate-200 p-4 text-[12.5px] text-slate-500">
                {lanes.length === 0
                  ? "No events on this case yet. Add an entity, then plot an event."
                  : "No entities match that search or filter."}
              </div>
            )}
            </div>
            {edges.top ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-slate-50 to-transparent dark:from-zinc-950" />
            ) : null}
            {edges.bottom ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-slate-50 to-transparent dark:from-zinc-950" />
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}
