import { useMemo, useState } from "react";
import { GitFork, LayoutGrid, Phone, Radio, Truck, User, MapPin, Box } from "lucide-react";
import type { EntityRecord } from "./db";
import {
  canonicalEntityType,
  relationshipDisplayLabel,
  type EntityRelationship,
  type EntityType,
} from "./types";
import { getCategoryColor } from "./utils/categoryColors";
import { formatRoleLabel } from "./utils/roleBadge";

const mono = "font-mono";

const COLUMNS: { key: ReturnType<typeof canonicalEntityType>; label: string }[] = [
  { key: "person", label: "People" },
  { key: "vehicle", label: "Vehicles" },
  { key: "location", label: "Locations" },
  { key: "phone", label: "Phones" },
  { key: "digital", label: "Digital" },
  { key: "exhibit", label: "Exhibits" },
];

function TypeIcon({ type }: { type: EntityType | string }) {
  const c = canonicalEntityType(type);
  const cls = "h-3.5 w-3.5";
  if (c === "vehicle") return <Truck className={cls} />;
  if (c === "phone") return <Phone className={cls} />;
  if (c === "digital") return <Radio className={cls} />;
  if (c === "exhibit") return <Box className={cls} />;
  if (c === "person") return <User className={cls} />;
  return <MapPin className={cls} />;
}

type Props = {
  entities: EntityRecord[];
  relationships: EntityRelationship[];
  onOpenEntity?: (entity: EntityRecord) => void;
};

export default function EntityGraph({ entities, relationships, onOpenEntity }: Props) {
  const [mode, setMode] = useState<"graph" | "matrix">("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const grouped = useMemo(() => {
    const map = new Map<string, EntityRecord[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    for (const ent of entities) {
      const key = canonicalEntityType(ent.type);
      map.get(key)?.push(ent);
    }
    return map;
  }, [entities]);

  const visibleRels = useMemo(() => {
    if (filter === "all") return relationships;
    return relationships.filter((r) => r.relationshipType === filter);
  }, [relationships, filter]);

  const linked = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set<string>([selectedId]);
    for (const r of visibleRels) {
      if (r.sourceEntityId === selectedId) ids.add(r.targetEntityId);
      if (r.targetEntityId === selectedId) ids.add(r.sourceEntityId);
    }
    return ids;
  }, [selectedId, visibleRels]);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
    const colW = 168;
    const gapX = 36;
    const rowH = 52;
    let maxRows = 1;
    COLUMNS.forEach((col, ci) => {
      const rows = grouped.get(col.key) ?? [];
      maxRows = Math.max(maxRows, rows.length, 1);
      rows.forEach((ent, ri) => {
        positions.set(ent.id, {
          x: 24 + ci * (colW + gapX),
          y: 56 + ri * rowH,
          w: colW,
          h: 40,
        });
      });
    });
    return {
      positions,
      width: 24 + COLUMNS.length * (colW + gapX),
      height: 72 + maxRows * rowH,
    };
  }, [grouped]);

  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  const select = (id: string) => {
    setSelectedId(id);
    const ent = byId.get(id);
    if (ent) onOpenEntity?.(ent);
  };

  return (
    <div className="flex h-[calc(100vh-94px)] min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5">
        <span className={`${mono} text-[11px] tracking-[0.12em] text-slate-500`}>ENTITY GRAPH</span>
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          <button type="button" onClick={() => setMode("graph")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${mode === "graph" ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600"}`}>
            <GitFork className="h-3.5 w-3.5" />Graph
          </button>
          <button type="button" onClick={() => setMode("matrix")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] ${mode === "matrix" ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600"}`}>
            <LayoutGrid className="h-3.5 w-3.5" />Matrix
          </button>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={`h-7 rounded-lg border border-slate-200 bg-white px-2 ${mono} text-[10.5px] text-slate-600`}
        >
          <option value="all">All links</option>
          <option value="registered_owner">Registered owner</option>
          <option value="operator_driver">Operator / driver</option>
          <option value="passenger">Passenger</option>
          <option value="residence">Residence</option>
          <option value="crime_scene">Crime scene</option>
          <option value="last_known_location">Last known location</option>
          <option value="phone_subscriber">Phone subscriber</option>
          <option value="cell_tower_ping">Cell ping</option>
          <option value="associate_of">Associate</option>
        </select>
        <div className="flex-1" />
        <span className={`${mono} text-[11px] text-slate-500`}>
          {entities.length} ENTITIES · {visibleRels.length} EDGES
        </span>
      </div>

      {mode === "graph" ? (
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
          {entities.length === 0 ? (
            <div className="px-8 py-20 text-center text-[13px] text-slate-500">Add entities in Setup or extract a source to populate the graph.</div>
          ) : (
            <div className="relative" style={{ width: layout.width, height: layout.height }}>
              <svg width={layout.width} height={layout.height} className="absolute inset-0">
                {visibleRels.map((rel) => {
                  const a = layout.positions.get(rel.sourceEntityId);
                  const b = layout.positions.get(rel.targetEntityId);
                  if (!a || !b) return null;
                  const leftFirst = a.x <= b.x;
                  const from = leftFirst ? a : b;
                  const to = leftFirst ? b : a;
                  const x1 = from.x + from.w;
                  const y1 = from.y + from.h / 2;
                  const x2 = to.x;
                  const y2 = to.y + to.h / 2;
                  const dim = selectedId && !linked.has(rel.sourceEntityId) && !linked.has(rel.targetEntityId);
                  const hot = selectedId && (rel.sourceEntityId === selectedId || rel.targetEntityId === selectedId);
                  return (
                    <g key={rel.id} opacity={dim ? 0.18 : 1}>
                      <path
                        d={`M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={hot ? "#d97706" : "#94a3b8"}
                        strokeWidth={hot ? 2 : 1.25}
                      />
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" fill="#64748b" style={{ fontSize: 9 }}>
                        {relationshipDisplayLabel(rel.relationshipType, rel.label)}
                      </text>
                    </g>
                  );
                })}
                {COLUMNS.map((col, ci) => (
                  <text key={col.key} x={24 + ci * 204 + 84} y={28} textAnchor="middle" fill="#94a3b8" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
                    {col.label.toUpperCase()}
                  </text>
                ))}
              </svg>
              {entities.map((ent) => {
                const pos = layout.positions.get(ent.id);
                if (!pos) return null;
                const hot = !selectedId || linked.has(ent.id);
                const active = selectedId === ent.id;
                const tone = getCategoryColor({ entityType: ent.type, role: ent.role, name: ent.name }, "border");
                return (
                  <button
                    key={ent.id}
                    type="button"
                    onClick={() => select(ent.id)}
                    className={`absolute z-[1] flex items-center gap-2 overflow-hidden rounded-[10px] border bg-white px-2.5 text-left shadow-sm ${tone} ${active ? "ring-2 ring-amber-400" : ""} ${ent.uncorroborated || ent.provenanceTier === "secondary" ? "border-dashed border-amber-400" : ""}`}
                    style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h, opacity: hot ? 1 : 0.28 }}
                    title={`${ent.name} · ${formatRoleLabel(ent.classification || ent.role) || ent.type}`}
                  >
                    <TypeIcon type={ent.type} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{ent.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {entities.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-slate-500">No entities to cross-reference yet.</div>
          ) : (
            <table className="min-w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold">Source \\ Target</th>
                  {entities.map((col) => (
                    <th key={col.id} className={`max-w-[120px] border border-slate-200 bg-slate-50 px-2 py-2 font-medium ${selectedId === col.id ? "bg-amber-50" : ""}`}>
                      <span className="line-clamp-2">{col.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entities.map((row) => (
                  <tr key={row.id}>
                    <th className={`sticky left-0 z-10 border border-slate-200 bg-white px-2 py-2 text-left font-medium ${selectedId === row.id ? "bg-amber-50" : ""}`}>
                      {row.name}
                    </th>
                    {entities.map((col) => {
                      const hits = visibleRels.filter((r) => r.sourceEntityId === row.id && r.targetEntityId === col.id);
                      const on = selectedId && (row.id === selectedId || col.id === selectedId);
                      return (
                        <td
                          key={col.id}
                          onClick={() => select(row.id)}
                          className={`cursor-pointer border border-slate-200 px-1.5 py-1.5 align-top ${hits.length ? "bg-blue-50/80" : "bg-white"} ${on && hits.length ? "ring-1 ring-amber-400" : ""}`}
                        >
                          {hits.map((h) => (
                            <div key={h.id} className={`${mono} text-[10px] leading-tight text-blue-800`}>
                              {relationshipDisplayLabel(h.relationshipType, h.label)}
                              <span className="text-slate-400"> · {Math.round(h.confidence * 100)}%</span>
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
