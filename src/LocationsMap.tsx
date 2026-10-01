import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Plus, Radar, Search, Trash2 } from "lucide-react";
import type { CaseRecord, EntityRecord, TimelineEventRecord } from "./db";
import { createEntity, deleteEntity } from "./db";
import { geocodeQuery, jitterLatLng, parseCoordinates, type LatLng } from "./lib/geo";
import { applyDupDecision, clusterDuplicateLocations, entityToSide, findDuplicateLocation, mergeLocationCluster, type DupDecision, type DupMatch } from "./lib/duplicates";
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
  onArbitrate,
}: {
  activeCase: CaseRecord;
  places: EntityRecord[];
  events: TimelineEventRecord[];
  onArbitrate?: (match: DupMatch) => Promise<DupDecision>;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | SearchLocationKind>("all");
  const [mapped, setMapped] = useState<MappedPlace[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [placeCoords, setPlaceCoords] = useState("");
  const [placeKind, setPlaceKind] = useState<SearchLocationKind>("last_seen");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);
  const [merging, setMerging] = useState(false);
  const deleteRef = useRef<(id: string) => void>(() => {});

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

  const duplicateClusters = useMemo(() => clusterDuplicateLocations(places), [places]);

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
        `<div style="min-width:180px"><strong>${row.entity.name}</strong><div style="margin-top:4px;font-size:12px;color:#475569">${formatLocationKindLabel(row.kind)}</div><div style="margin-top:4px;font-size:12px">${row.address}</div><div style="margin-top:4px;font-size:11px;color:#64748b">${row.dateLogged}</div><p style="margin-top:6px;font-size:12px;color:#334155">${row.entity.notes || "No relevance notes."}</p><button type="button" class="loc-del" data-id="${row.entity.id}" style="margin-top:8px;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer">Delete location</button></div>`,
      );
      marker.on("popupopen", () => {
        const btn = document.querySelector<HTMLButtonElement>(`.loc-del[data-id="${row.entity.id}"]`);
        btn?.addEventListener("click", (ev) => {
          ev.preventDefault();
          deleteRef.current(row.entity.id);
        });
      });
      marker.on("click", () => setFocusId(row.entity.id));
    }
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 14 });
  }, [filtered]);

  const submitPlace = async () => {
    if (!placeName.trim() || savingPlace) return;
    setSavingPlace(true);
    setPlaceError(null);
    try {
      const parsed = parseCoordinates(placeCoords);
      const nameHit = await findDuplicateLocation(activeCase.id, { name: placeName.trim(), address: placeAddress.trim(), latlng: parsed });
      if (nameHit) {
        if (!onArbitrate) {
          setPlaceError("A nearby or matching location already exists.");
          return;
        }
        const decision = await onArbitrate({
          kind: "location",
          existingId: nameHit.id,
          existing: entityToSide(nameHit),
          incoming: entityToSide({ ...nameHit, id: "incoming", name: placeName.trim(), notes: placeAddress.trim() }, true),
        });
        const applied = await applyDupDecision(
          { kind: "location", existingId: nameHit.id, existing: entityToSide(nameHit), incoming: entityToSide(nameHit, true) },
          decision,
          { ...nameHit, name: placeName.trim(), notes: placeAddress.trim() },
        );
        if (applied.action !== "replace") {
          setAdding(false);
          setPlaceName("");
          setPlaceAddress("");
          setPlaceCoords("");
          return;
        }
      }
      const latlng = parsed || await geocodeQuery([placeName, placeAddress, activeCase.jurisdiction].filter(Boolean).join(", "));
      const draft = {
        caseId: activeCase.id,
        name: placeName.trim(),
        type: "place" as const,
        role: "UNVERIFIED",
        notes: placeAddress.trim(),
        classification: "UNVERIFIED",
        metadata: {
          address: placeAddress.trim(),
          coordinates: latlng ? `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}` : placeCoords.trim(),
          locationKind: placeKind,
          searchStatus: "Unchecked",
        },
      };
      if (!nameHit && latlng) {
        const near = await findDuplicateLocation(activeCase.id, { name: draft.name, address: draft.notes, latlng });
        if (near && onArbitrate) {
          const decision = await onArbitrate({
            kind: "location",
            existingId: near.id,
            existing: entityToSide(near),
            incoming: entityToSide({ ...near, id: "incoming", name: draft.name, notes: draft.notes, metadata: draft.metadata }, true),
          });
          const applied = await applyDupDecision(
            { kind: "location", existingId: near.id, existing: entityToSide(near), incoming: entityToSide(near, true) },
            decision,
            { ...near, name: draft.name, notes: draft.notes, metadata: draft.metadata },
          );
          if (applied.action !== "replace") {
            setAdding(false);
            setPlaceName("");
            setPlaceAddress("");
            setPlaceCoords("");
            return;
          }
        }
      }
      await createEntity(draft);
      setAdding(false);
      setPlaceName("");
      setPlaceAddress("");
      setPlaceCoords("");
    } catch (err) {
      setPlaceError(err instanceof Error ? err.message : "Could not add that point.");
    } finally {
      setSavingPlace(false);
    }
  };

  const confirmDelete = (id: string) => {
    const row = places.find((p) => p.id === id);
    if (!row) return;
    if (!window.confirm(`Delete location “${row.name}”? Linked events on this place will also be removed.`)) return;
    void deleteEntity(id);
  };
  deleteRef.current = confirmDelete;

  const mergeOneCluster = async (ids: string[]) => {
    setMerging(true);
    try {
      await mergeLocationCluster(ids);
    } finally {
      setMerging(false);
    }
  };

  const mergeAllDuplicates = async () => {
    setMerging(true);
    try {
      for (const cluster of duplicateClusters) {
        await mergeLocationCluster(cluster.map((row) => row.id));
      }
    } finally {
      setMerging(false);
    }
  };

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
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-[18px] font-semibold tracking-tight text-slate-900">Locations & Map</h1>
              <p className="mt-1 text-[12.5px] text-slate-500">Filter the registry or add a search point. Nearby duplicates (within 50m) pause for review.</p>
            </div>
            <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 px-2 text-[12px] font-medium text-slate-700 hover:border-blue-500">
              <Plus className="h-3.5 w-3.5" />Add
            </button>
          </div>
          {adding ? (
            <div className="mt-3 space-y-2 rounded-[12px] border border-slate-200 bg-slate-50 p-3">
              <input value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Location name" className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]" />
              <input value={placeAddress} onChange={(e) => setPlaceAddress(e.target.value)} placeholder="Address" className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]" />
              <input value={placeCoords} onChange={(e) => setPlaceCoords(e.target.value)} placeholder="Lat, lng (optional)" className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]" />
              <select value={placeKind} onChange={(e) => setPlaceKind(e.target.value as SearchLocationKind)} className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]">
                <option value="last_seen">Last seen</option>
                <option value="item_recovered">Item recovered</option>
                <option value="cell_ping">Cell ping</option>
                <option value="search_grid">Search grid</option>
              </select>
              {placeError ? <p className="text-[12px] text-rose-700">{placeError}</p> : null}
              <button type="button" disabled={savingPlace || !placeName.trim()} onClick={() => void submitPlace()} className="h-9 w-full rounded-lg bg-blue-600 text-[12.5px] font-semibold text-white disabled:opacity-40">
                {savingPlace ? "Checking…" : "Save search point"}
              </button>
            </div>
          ) : null}
          {duplicateClusters.length ? (
            <div className="mt-3 rounded-[12px] border border-amber-200 bg-amber-50 p-3">
              <p className="text-[12.5px] font-medium text-amber-900">
                Potential duplicate locations detected
              </p>
              <ul className="mt-1.5 space-y-1">
                {duplicateClusters.map((cluster) => (
                  <li key={cluster.map((row) => row.id).join("-")} className="flex items-center justify-between gap-2 text-[12px] text-amber-900">
                    <span>{cluster[0].name} ({cluster.length} entries)</span>
                    <button
                      type="button"
                      disabled={merging}
                      onClick={() => void mergeOneCluster(cluster.map((row) => row.id))}
                      className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-100"
                    >
                      Merge Entries
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={merging}
                onClick={() => void mergeAllDuplicates()}
                className="mt-2 h-8 w-full rounded-lg bg-amber-700 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                {merging ? "Merging…" : "Merge Duplicates"}
              </button>
            </div>
          ) : null}
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
                    <div className={`rounded-[12px] border px-3 py-3 transition-colors ${on ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                      <button
                        type="button"
                        onMouseEnter={() => focusOn(row.entity.id)}
                        onClick={() => focusOn(row.entity.id, true)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start gap-2">
                          {row.kind === "cell_ping" ? <Radar className="mt-0.5 h-4 w-4 shrink-0" style={{ color: PIN[row.kind].color }} /> : <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: PIN[row.kind].color }} />}
                          <div className="min-w-0 flex-1">
                            <div className="whitespace-normal text-[13.5px] font-semibold leading-snug text-slate-900 line-clamp-2">{row.entity.name}</div>
                            <div className="mt-0.5 whitespace-normal text-[12px] leading-snug text-slate-600 line-clamp-2">{row.address}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full border px-2 py-0.5 ${mono} text-[10px] tracking-[0.06em] text-slate-700`}>
                                {formatTag(row.kind)}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${searchStatusClass(status)}`}>{status}</span>
                              {duplicateClusters.some((cluster) => cluster.some((item) => item.id === row.entity.id) && cluster.length > 1) ? (
                                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">Duplicate</span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500">{row.dateLogged}</div>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${row.entity.name}`}
                        onClick={() => confirmDelete(row.entity.id)}
                        className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-2 text-[12px] font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete location
                      </button>
                    </div>
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
