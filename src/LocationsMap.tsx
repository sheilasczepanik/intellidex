import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Radar, Search } from "lucide-react";
import type { CaseRecord, EntityRecord, TimelineEventRecord } from "./db";
import { geocodeQuery, jitterLatLng, parseCoordinates, type LatLng } from "./lib/geo";
import { formatTag } from "./lib/formatTag";
import {
  formatLocationKindLabel,
  inferSearchLocationKind,
  inferSearchStatus,
  parseLksTimestamp,
  searchStatusClass,
  type SearchLocationKind,
} from "./lib/missingPerson";

const mono = "font-mono";

const PIN: Record<SearchLocationKind, { color: string; label: string }> = {
  last_seen: { color: "#dc2626", label: "Last seen" },
  item_recovered: { color: "#4f46e5", label: "Item recovered" },
  cell_ping: { color: "#0891b2", label: "Cell ping" },
  search_grid: { color: "#64748b", label: "Search grid" },
};

type MappedPlace = {
  entity: EntityRecord;
  kind: SearchLocationKind;
  latlng: LatLng;
  address: string;
  dateLogged: string;
};

function pinIcon(kind: SearchLocationKind) {
  const color = PIN[kind].color;
  const inner = kind === "cell_ping"
    ? `<span style="display:block;width:22px;height:22px;border-radius:999px;border:2px solid ${color};background:${color}33;box-shadow:0 0 0 6px ${color}22"></span>`
    : `<span style="display:block;width:14px;height:14px;border-radius:999px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(15,23,42,.35)"></span>`;
  return L.divIcon({
    className: "locations-map-pin",
    html: inner,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

export default function LocationsMap({
  activeCase,
  places,
  events,
}: {
  activeCase: CaseRecord;
  places: EntityRecord[];
  events: TimelineEventRecord[];
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | SearchLocationKind>("all");
  const [mapped, setMapped] = useState<MappedPlace[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);

  const lksMs = parseLksTimestamp(activeCase);
  const placeKey = places.map((p) => p.id).join("|");

  useEffect(() => {
    let cancelled = false;
    const snapshot = places;
    void (async () => {
      setGeoBusy(true);
      const fallbackQuery = activeCase.lksLocation || activeCase.jurisdiction || "United States";
      const origin = (await geocodeQuery(fallbackQuery)) || { lat: 39.8283, lng: -98.5795 };
      const next: MappedPlace[] = [];
      for (const entity of snapshot) {
        if (cancelled) return;
        const kind = inferSearchLocationKind(entity);
        const address = entity.metadata?.address || entity.metadata?.jurisdiction || entity.notes || fallbackQuery;
        const fromMeta = parseCoordinates(entity.metadata?.coordinates || entity.metadata?.coords || "");
        let latlng = fromMeta;
        if (!latlng) latlng = await geocodeQuery([entity.name, address, fallbackQuery].filter(Boolean).join(", "));
        if (!latlng) latlng = jitterLatLng(entity.id, origin);
        const related = events.filter((ev) => ev.entityId === entity.id).sort((a, b) => a.timestamp - b.timestamp);
        const dateLogged = entity.metadata?.dateLogged
          || (related[0] ? new Date(related[0].timestamp).toLocaleDateString() : (lksMs ? new Date(lksMs).toLocaleDateString() : "Date not logged"));
        next.push({ entity, kind, latlng, address, dateLogged });
      }
      if (!cancelled) setMapped(next);
      if (!cancelled) setGeoBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [placeKey, activeCase.id, activeCase.lksLocation, activeCase.jurisdiction, lksMs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mapped.filter((row) => {
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (!q) return true;
      return `${row.entity.name} ${row.address} ${row.kind}`.toLowerCase().includes(q);
    });
  }, [mapped, query, kindFilter]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { scrollWheelZoom: true, zoomControl: true }).setView([39.8283, -98.5795], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resize = () => map.invalidateSize();
    window.setTimeout(resize, 80);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layersRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const row of filtered) {
      const { lat, lng } = row.latlng;
      bounds.push([lat, lng]);
      if (row.kind === "search_grid") {
        L.circle([lat, lng], {
          radius: 450,
          color: PIN.search_grid.color,
          dashArray: "6 6",
          weight: 2,
          fillOpacity: 0.08,
        }).addTo(group);
      }
      if (row.kind === "cell_ping") {
        L.circle([lat, lng], {
          radius: 220,
          color: PIN.cell_ping.color,
          weight: 1,
          fillColor: PIN.cell_ping.color,
          fillOpacity: 0.12,
        }).addTo(group);
      }
      const marker = L.marker([lat, lng], { icon: pinIcon(row.kind) }).addTo(group);
      marker.bindPopup(
        `<div style="min-width:180px"><strong>${row.entity.name}</strong><div style="margin-top:4px;font-size:12px;color:#475569">${formatLocationKindLabel(row.kind)}</div><div style="margin-top:4px;font-size:12px">${row.address}</div><div style="margin-top:4px;font-size:11px;color:#64748b">${row.dateLogged}</div><p style="margin-top:6px;font-size:12px;color:#334155">${row.entity.notes || "No relevance notes."}</p></div>`,
      );
      marker.on("click", () => setFocusId(row.entity.id));
    }
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 14 });
  }, [filtered]);

  const focusOn = (id: string, zoom = false) => {
    const row = mapped.find((r) => r.entity.id === id);
    const map = mapRef.current;
    if (!row || !map) return;
    setFocusId(id);
    if (zoom) map.setView([row.latlng.lat, row.latlng.lng], 15, { animate: true });
    else map.panTo([row.latlng.lat, row.latlng.lng], { animate: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <div className="relative min-h-[46vh] flex-1 bg-slate-200 lg:min-h-0">
        <div ref={mapEl} className="absolute inset-0 z-0" />
        {geoBusy ? (
          <div className="absolute left-3 top-3 z-[400] rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] text-slate-600">
            Plotting search points…
          </div>
        ) : null}
      </div>
      <aside className="flex max-h-[46vh] w-full shrink-0 flex-col border-t border-slate-200 bg-white lg:max-h-none lg:h-auto lg:w-[360px] lg:border-l lg:border-t-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">Locations & Map</h1>
          <p className="mt-1 text-[12.5px] text-slate-500">Filter the registry to center the map on a last-seen point, ping, recovery, or search grid.</p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter locations"
              className="h-9 w-full rounded-[10px] border border-slate-300 bg-white pl-8 pr-3 text-[13px] outline-none focus:border-blue-600"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["all", "last_seen", "item_recovered", "cell_ping", "search_grid"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setKindFilter(key === "all" ? "all" : key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${kindFilter === key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
              >
                {key === "all" ? "All" : formatTag(key)}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-slate-500">No logged search areas yet. Add a place from Overview or intake.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((row) => {
                const status = inferSearchStatus(row.entity);
                const on = focusId === row.entity.id;
                return (
                  <li key={row.entity.id}>
                    <button
                      type="button"
                      onMouseEnter={() => focusOn(row.entity.id)}
                      onClick={() => focusOn(row.entity.id, true)}
                      className={`w-full rounded-[12px] border px-3 py-3 text-left transition-colors ${on ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <div className="flex items-start gap-2">
                        {row.kind === "cell_ping" ? <Radar className="mt-0.5 h-4 w-4 shrink-0" style={{ color: PIN[row.kind].color }} /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: PIN[row.kind].color }} />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-semibold text-slate-900">{row.entity.name}</div>
                          <div className="mt-0.5 truncate text-[12px] text-slate-600">{row.address}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full border px-2 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-slate-700`}>
                              {formatTag(row.kind)}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${searchStatusClass(status)}`}>{status}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">{row.dateLogged}</div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
