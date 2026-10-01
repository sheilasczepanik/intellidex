import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Car, CircleHelp, Home, Plus, Search, Shield, Trash2 } from "lucide-react";
import { createEntity, db, type CaseRecord, type EntityRecord, type EntityRelationship, type TimelineEventRecord } from "./db";
import { geocodeQuery, jitterLatLng, metersBetween, parseCoordinates, type LatLng } from "./lib/geo";
import { applyDupDecision, clusterDuplicateLocations, entityToSide, findDuplicateLocation, mergeLocationCluster, type DupDecision, type DupMatch } from "./lib/duplicates";
import { inferSearchLocationKind, type SearchLocationKind } from "./lib/missingPerson";
import { useLocations } from "./lib/useLocations";

const mono = "font-mono";

type PinAccent = "subject" | "official" | "sighting";
type PinGlyph = "car" | "shield" | "home" | "question";
type SortMode = "chronological" | "verified" | "sightings";
type SubjectOption = { id: string; name: string };

type MappedPlace = {
  entity: EntityRecord;
  kind: SearchLocationKind;
  latlng: LatLng;
  precise: boolean;
  address: string;
  dateLogged: string;
};

type RouteStop = {
  placeId: string;
  title: string;
  timeLabel: string;
  latlng: LatLng | null;
  precise: boolean;
  sortKey: number;
};

const ACCENT: Record<PinAccent, string> = {
  subject: "#2563eb",
  official: "#059669",
  sighting: "#d97706",
};

const GLYPH_PATH: Record<PinGlyph, string> = {
  car: `<path d="M3 10.5h10M4.2 10.5 5.4 7.2h5.2l1.2 3.3"/><circle cx="5.3" cy="12.2" r="1"/><circle cx="10.7" cy="12.2" r="1"/>`,
  shield: `<path d="M8 1.8 13 3.6v3.8c0 2.6-1.9 4.4-5 5.6-3.1-1.2-5-3-5-5.6V3.6L8 1.8Z"/>`,
  home: `<path d="M2.2 7.2 8 2.2l5.8 5V14H9.6V9.2H6.4V14H2.2V7.2Z"/>`,
  question: `<path d="M6.1 6.1a1.9 1.9 0 1 1 2.6 1.8c-.7.3-1.1.8-1.1 1.5"/><path d="M8 12.3h.01"/>`,
};

const GLYPH_ICON = {
  car: Car,
  shield: Shield,
  home: Home,
  question: CircleHelp,
} as const;

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mentions(blob: string, name: string) {
  const needle = norm(name);
  if (needle.length < 4) return false;
  return norm(blob).includes(needle);
}

function classifyPin(entity: EntityRecord, kind: SearchLocationKind): { accent: PinAccent; glyph: PinGlyph } {
  const blob = `${entity.name} ${entity.role} ${entity.notes} ${entity.metadata?.address || ""} ${entity.metadata?.locationKind || ""}`.toLowerCase();
  if (/police|dispatch|trooper|sheriff|precinct|sergeant|station/.test(blob)) {
    return { accent: "official", glyph: "shield" };
  }
  if (/residence|home|house|motel|witness|atwood/.test(blob) && !/crash|accident/.test(blob)) {
    return { accent: /unverified|sighting|tip/.test(blob) ? "sighting" : "official", glyph: "home" };
  }
  if (/crash|accident|vehicle|barn|route|abandoned/.test(blob) || kind === "last_seen" || kind === "item_recovered") {
    return { accent: "subject", glyph: "car" };
  }
  if (/sighting|reported|tip|unverified/.test(blob) || kind === "cell_ping") {
    return { accent: "sighting", glyph: "question" };
  }
  if (kind === "search_grid") return { accent: "sighting", glyph: "question" };
  return { accent: "official", glyph: "shield" };
}

function pinIcon(glyph: PinGlyph, accent: PinAccent) {
  const color = ACCENT[accent];
  const html = `<div style="width:32px;height:40px;filter:drop-shadow(0 2px 3px rgba(15,23,42,.38))"><svg width="32" height="40" viewBox="0 0 32 40" fill="none" aria-hidden="true"><path d="M16 37.2c0 0-11-14.2-11-22.2a11 11 0 1 1 22 0c0 8-11 22.2-11 22.2z" fill="${color}" stroke="white" stroke-width="2"/><g transform="translate(8 6.2)" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none">${GLYPH_PATH[glyph]}</g></svg></div>`;
  return L.divIcon({
    className: "locations-map-pin",
    html,
    iconSize: [32, 40],
    iconAnchor: [16, 37],
  });
}

function segmentIcon(label: string) {
  return L.divIcon({
    className: "locations-route-label",
    html: `<div style="transform:translate(-50%,-50%);display:inline-block;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:2px 7px;font:11px ui-monospace,SFMono-Regular,monospace;color:#334155;box-shadow:0 1px 2px rgba(15,23,42,.12);white-space:nowrap">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function eventInvolvesSubject(event: TimelineEventRecord, subject: SubjectOption) {
  if (subject.id !== "__case_subject__" && event.entityId === subject.id) return true;
  return mentions(`${event.title} ${event.description}`, subject.name);
}

function eventInvolvesPlace(event: TimelineEventRecord, place: EntityRecord, latlng: LatLng | null) {
  if (event.entityId === place.id) return true;
  const blob = `${event.title} ${event.description}`;
  if (mentions(blob, place.name)) return true;
  if (place.metadata?.address && mentions(blob, place.metadata.address)) return true;
  if (latlng && typeof event.latitude === "number" && typeof event.longitude === "number") {
    return metersBetween(latlng, { lat: event.latitude, lng: event.longitude }) <= 200;
  }
  return false;
}

function linkedEvents(place: EntityRecord, events: TimelineEventRecord[], latlng: LatLng | null) {
  return events
    .filter((event) => eventInvolvesPlace(event, place, latlng))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function locationVerified(entity: EntityRecord, related: TimelineEventRecord[]) {
  const blob = `${entity.classification || ""} ${entity.role || ""} ${entity.metadata?.searchStatus || ""}`;
  if (/unverified/i.test(blob)) return false;
  if (/verified/i.test(blob) || /cleared/i.test(entity.metadata?.searchStatus || "")) return true;
  if (related.some((event) => event.isVerified && event.confidenceTier !== "TIER_2_UNVERIFIED" && event.confidenceTier !== "TIER_3_CONTRADICTED")) return true;
  return false;
}

function formatCaseDate(raw: string) {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function subjectLabel(subject: SubjectOption, activeCase: CaseRecord) {
  const subjectName = (activeCase.subjectName || activeCase.title || "").trim().toLowerCase();
  const isSubject = subject.name.trim().toLowerCase() === subjectName;
  const raw = isSubject ? (activeCase.lksAt || activeCase.incidentStart || "") : "";
  const date = formatCaseDate(raw);
  return date ? `${subject.name} — ${date}` : subject.name;
}

function clockLabel(ts: number, approximate: boolean) {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${approximate ? "~" : ""}${hh}:${mm}`;
}

function sourceLabel(related: TimelineEventRecord[], activeCase: CaseRecord) {
  const cited = related.find((event) => event.sourceCitation?.sourceName)?.sourceCitation?.sourceName;
  if (cited) return cited;
  const doc = related.map((event) => event.sourceDocId).find((id) => id && !/^ev[-_]/i.test(id) && id.length <= 40);
  if (doc) return doc;
  return activeCase.fileIdentifier || "—";
}

function lastActivity(related: TimelineEventRecord[], dateLogged: string) {
  const last = related[related.length - 1];
  if (!last) return dateLogged || "—";
  return new Date(last.timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function segmentBetween(a: LatLng, b: LatLng) {
  const meters = metersBetween(a, b);
  const miles = meters / 1609.344;
  const minutes = (miles / 35) * 60;
  const distance = meters < 185
    ? `${Math.max(1, Math.round(meters * 1.09361))} yd`
    : `${miles < 10 ? miles.toFixed(miles < 1 ? 2 : 1) : Math.round(miles)} mi`;
  const drive = minutes < 1 ? "< 1 min" : minutes < 90 ? `${Math.max(1, Math.round(minutes))} min` : `${(minutes / 60).toFixed(1)} hr`;
  return { distance, drive, label: `${distance} · ${drive}` };
}

function explicitPlaceIds(
  subject: SubjectOption,
  rows: MappedPlace[],
  events: TimelineEventRecord[],
  relationships: EntityRelationship[],
) {
  const ids = new Set<string>();
  for (const edge of relationships) {
    const ends = [edge.sourceEntityId, edge.targetEntityId];
    if (!ends.includes(subject.id)) continue;
    const other = ends[0] === subject.id ? ends[1] : ends[0];
    if (rows.some((row) => row.entity.id === other)) ids.add(other);
  }
  for (const row of rows) {
    const hit = events.some((event) => eventInvolvesSubject(event, subject) && eventInvolvesPlace(event, row.entity, row.latlng));
    if (hit) ids.add(row.entity.id);
  }
  return ids;
}

function buildStops(rows: MappedPlace[], events: TimelineEventRecord[]): RouteStop[] {
  return rows.map((row) => {
    const related = linkedEvents(row.entity, events, row.latlng);
    const timed = related[0];
    if (timed) {
      const approximate = !timed.isVerified || timed.confidenceTier === "TIER_2_UNVERIFIED";
      return {
        placeId: row.entity.id,
        title: row.entity.name,
        timeLabel: clockLabel(timed.timestamp, approximate),
        latlng: row.latlng,
        precise: row.precise,
        sortKey: timed.timestamp,
      };
    }
    const raw = row.entity.metadata?.dateLogged || row.dateLogged || "";
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
      return {
        placeId: row.entity.id,
        title: row.entity.name,
        timeLabel: formatCaseDate(raw) || "—",
        latlng: row.latlng,
        precise: row.precise,
        sortKey: ts,
      };
    }
    return {
      placeId: row.entity.id,
      title: row.entity.name,
      timeLabel: "—",
      latlng: row.latlng,
      precise: row.precise,
      sortKey: Number.MAX_SAFE_INTEGER,
    };
  }).sort((a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title));
}

function sortPlaces(rows: MappedPlace[], sort: SortMode, events: TimelineEventRecord[]) {
  const copy = [...rows];
  const stamp = (row: MappedPlace) => linkedEvents(row.entity, events, row.latlng)[0]?.timestamp ?? Number.MAX_SAFE_INTEGER;
  const verified = (row: MappedPlace) => locationVerified(row.entity, linkedEvents(row.entity, events, row.latlng));
  if (sort === "verified") {
    copy.sort((a, b) => Number(verified(b)) - Number(verified(a)) || stamp(a) - stamp(b));
  } else if (sort === "sightings") {
    copy.sort((a, b) => Number(verified(a)) - Number(verified(b)) || stamp(a) - stamp(b));
  } else {
    copy.sort((a, b) => stamp(a) - stamp(b) || a.entity.name.localeCompare(b.entity.name));
  }
  return copy;
}

function pickPrimary(cluster: EntityRecord[]) {
  return cluster.find((row) => {
    const blob = `${row.classification || ""} ${row.role || ""}`;
    return /verified/i.test(blob) && !/unverified/i.test(blob);
  }) || cluster[0];
}

function offsetCenter(map: L.Map, latlng: LatLng, zoom: number) {
  const point = map.project([latlng.lat, latlng.lng], zoom);
  if (window.innerWidth >= 640) point.x -= 180;
  return map.unproject(point, zoom);
}

export default function LocationsMap({
  activeCase,
  places,
  events,
  onArbitrate,
  initialSubjectId = "",
  onViewChronology,
}: {
  activeCase: CaseRecord;
  places: EntityRecord[];
  events: TimelineEventRecord[];
  onArbitrate?: (match: DupMatch) => Promise<DupDecision>;
  initialSubjectId?: string;
  onViewChronology?: (placeId: string) => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const fittedKey = useRef("");

  const locationsApi = useLocations();
  const peopleQuery = useLiveQuery(
    () => db.entities.where("caseId").equals(activeCase.id).filter((row) => row.type === "person").toArray(),
    [activeCase.id],
  );
  const relationshipQuery = useLiveQuery(
    () => db.relationships.where("caseId").equals(activeCase.id).toArray(),
    [activeCase.id],
  );
  const people = useMemo(() => peopleQuery ?? [], [peopleQuery]);
  const relationships = useMemo(() => relationshipQuery ?? [], [relationshipQuery]);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("chronological");
  const [subjectPin, setSubjectPin] = useState(initialSubjectId);
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  if (subjectPin !== initialSubjectId) {
    setSubjectPin(initialSubjectId);
    setSubjectId(initialSubjectId);
  }
  const [mapped, setMapped] = useState<MappedPlace[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ id: string; x: number; y: number; width: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [placeCoords, setPlaceCoords] = useState("");
  const [placeKind, setPlaceKind] = useState<SearchLocationKind>("last_seen");
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [mergingCluster, setMergingCluster] = useState(false);

  const lksMs = activeCase.lksAt ? Date.parse(activeCase.lksAt) : NaN;
  const placeKey = places.map((place) => `${place.id}:${place.name}:${place.metadata?.coordinates || ""}:${place.metadata?.address || ""}`).join("|");

  const subjectChoices = useMemo<SubjectOption[]>(() => {
    const list = people.map((person) => ({ id: person.id, name: person.name }));
    const name = (activeCase.subjectName || "").trim();
    if (name && !list.some((person) => person.name.trim().toLowerCase() === name.toLowerCase())) {
      list.unshift({ id: "__case_subject__", name });
    }
    return list;
  }, [people, activeCase.subjectName]);

  const subject = subjectChoices.find((choice) => choice.id === subjectId) ?? null;

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
        const address = entity.metadata?.address?.trim()
          || entity.metadata?.jurisdiction?.trim()
          || fallbackQuery;
        const fromMeta = parseCoordinates(entity.metadata?.coordinates || entity.metadata?.coords || "");
        let latlng = fromMeta;
        let precise = Boolean(fromMeta);
        if (!latlng) {
          latlng = await geocodeQuery([entity.name, address].filter(Boolean).join(", "));
          precise = Boolean(latlng);
        }
        if (!latlng) {
          latlng = jitterLatLng(entity.id, origin);
          precise = false;
        }
        const related = linkedEvents(entity, events, latlng);
        const dateLogged = entity.metadata?.dateLogged
          || (related[0] ? new Date(related[0].timestamp).toLocaleDateString() : (Number.isFinite(lksMs) ? new Date(lksMs).toLocaleDateString() : "Date not logged"));
        next.push({ entity, kind, latlng, precise, address, dateLogged });
      }
      if (!cancelled) {
        setMapped(next);
        setGeoBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Geocode only when the place roster changes. `places` is read from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, activeCase.id, activeCase.lksLocation, activeCase.jurisdiction, lksMs]);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mapped.filter((row) => {
      if (!q) return true;
      const perimeter = row.kind === "search_grid" ? "perimeter search grid" : "";
      return `${row.entity.name} ${row.address} ${row.entity.notes} ${row.entity.metadata?.coordinates || ""} ${row.kind} ${perimeter}`.toLowerCase().includes(q);
    });
  }, [mapped, query]);

  const scoped = useMemo(() => {
    if (!subject) return matched;
    const explicit = explicitPlaceIds(subject, matched, events, relationships);
    const caseSubject = subject.name.trim().toLowerCase() === (activeCase.subjectName || activeCase.title || "").trim().toLowerCase();
    const ids = explicit.size > 0 || !caseSubject ? explicit : new Set(matched.map((row) => row.entity.id));
    return matched.filter((row) => ids.has(row.entity.id));
  }, [subject, matched, events, relationships, activeCase.subjectName, activeCase.title]);

  const listed = useMemo(() => sortPlaces(scoped, sort, events), [scoped, sort, events]);
  const routeStops = useMemo(() => (subject ? buildStops(scoped, events) : []), [subject, scoped, events]);
  const duplicateClusters = useMemo(() => clusterDuplicateLocations(places), [places]);
  const duplicateCount = duplicateClusters.reduce((sum, cluster) => sum + cluster.length, 0);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { scrollWheelZoom: true, zoomControl: false }).setView([39.8283, -98.5795], 4);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    map.on("click", () => setFocusId(null));
    mapRef.current = map;
    setMapReady(true);
    const resize = () => map.invalidateSize();
    window.setTimeout(resize, 80);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layersRef.current;
    if (!map || !group) return;
    group.clearLayers();
    map.invalidateSize();
    const bounds: L.LatLngExpression[] = [];
    const preciseBounds: L.LatLngExpression[] = [];

    if (subject && routeStops.length > 1) {
      for (let i = 0; i < routeStops.length - 1; i += 1) {
        const from = routeStops[i];
        const to = routeStops[i + 1];
        if (!from.latlng || !to.latlng || !from.precise || !to.precise) continue;
        const line: L.LatLngExpression[] = [[from.latlng.lat, from.latlng.lng], [to.latlng.lat, to.latlng.lng]];
        L.polyline(line, { color: "#2563eb", weight: 7, opacity: 0.16 }).addTo(group);
        L.polyline(line, { color: "#2563eb", weight: 2.5, opacity: 0.92, dashArray: "8 6" }).addTo(group);
        const metric = segmentBetween(from.latlng, to.latlng);
        const mid = { lat: (from.latlng.lat + to.latlng.lat) / 2, lng: (from.latlng.lng + to.latlng.lng) / 2 };
        L.marker([mid.lat, mid.lng], { icon: segmentIcon(metric.label), interactive: false }).addTo(group);
      }
    }

    for (const row of listed) {
      const { lat, lng } = row.latlng;
      bounds.push([lat, lng]);
      if (row.precise) preciseBounds.push([lat, lng]);
      const pin = classifyPin(row.entity, row.kind);
      const marker = L.marker([lat, lng], { icon: pinIcon(pin.glyph, pin.accent), zIndexOffset: focusId === row.entity.id ? 800 : 0 }).addTo(group);
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        setFocusId(row.entity.id);
      });
    }

    const fitSource = preciseBounds.length ? preciseBounds : bounds;
    const fitKey = `${subjectId}|${query}|${listed.map((row) => row.entity.id).join(",")}`;
    if (fitSource.length && fittedKey.current !== fitKey) {
      fittedKey.current = fitKey;
      const padLeft = window.innerWidth >= 640 ? 420 : 36;
      if (fitSource.length === 1) {
        const only = listed.find((row) => row.precise) || listed[0];
        if (only) map.setView(offsetCenter(map, only.latlng, 13), 13);
      } else {
        map.fitBounds(L.latLngBounds(fitSource), {
          paddingTopLeft: [padLeft, 36],
          paddingBottomRight: [48, 48],
          maxZoom: 14,
        });
      }
    }
  }, [listed, routeStops, subject, subjectId, query, focusId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const row = mapped.find((item) => item.entity.id === focusId);
    if (!row) return;
    const update = () => {
      const point = map.latLngToContainerPoint([row.latlng.lat, row.latlng.lng]);
      setAnchor({ id: row.entity.id, x: point.x, y: point.y, width: map.getSize().x });
    };
    map.on("move", update);
    map.on("zoom", update);
    const frame = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frame);
      map.off("move", update);
      map.off("zoom", update);
    };
  }, [focusId, mapped, mapReady]);

  const focusOn = (id: string, zoom = false) => {
    const row = mapped.find((item) => item.entity.id === id);
    const map = mapRef.current;
    if (!row || !map) return;
    setFocusId(id);
    const nextZoom = zoom ? Math.max(map.getZoom(), 15) : map.getZoom();
    map.setView(offsetCenter(map, row.latlng, nextZoom), nextZoom, { animate: true });
  };

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

  const confirmDelete = async () => {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    if (focusId === id) setFocusId(null);
    await locationsApi.deleteLocation(id);
  };

  const mergeIntoPrimary = async (targetId: string, duplicateId: string) => {
    await locationsApi.mergeLocations(targetId, duplicateId);
    if (focusId === duplicateId) setFocusId(targetId);
  };

  const mergeCluster = async (ids: string[]) => {
    setMergingCluster(true);
    try {
      await mergeLocationCluster(ids);
      setFocusId(null);
    } finally {
      setMergingCluster(false);
    }
  };

  const focused = listed.find((row) => row.entity.id === focusId) || mapped.find((row) => row.entity.id === focusId) || null;
  const deleteTarget = places.find((place) => place.id === deleteId) || null;

  const liveAnchor = anchor && anchor.id === focusId ? anchor : null;
  const popoverStyle = liveAnchor ? (() => {
    const width = 300;
    const sidebarClear = liveAnchor.width > 720 ? 400 : 12;
    let left = liveAnchor.x - width / 2;
    left = Math.max(sidebarClear, Math.min(left, liveAnchor.width - width - 12));
    const above = liveAnchor.y > 260;
    return {
      left,
      top: above ? liveAnchor.y - 14 : liveAnchor.y + 16,
      transform: above ? "translateY(-100%)" : undefined,
    };
  })() : null;

  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden">
      <div ref={mapEl} className="absolute inset-0 z-0" />
      <aside className="absolute left-3 top-3 z-[500] flex max-h-[min(52%,440px)] w-[min(380px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur-sm sm:bottom-3 sm:max-h-none">
        <div className="shrink-0 space-y-2.5 border-b border-slate-200 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">Locations & Map</h1>
              {geoBusy ? <p className="text-[11px] text-slate-500">Plotting search points…</p> : null}
            </div>
            <button type="button" onClick={() => setAdding((open) => !open)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 px-2 text-[12px] font-medium text-slate-700 hover:border-blue-500">
              <Plus className="h-3.5 w-3.5" />Add
            </button>
          </div>
          {subjectChoices.length ? (
            <select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              className="h-9 w-full rounded-[10px] border border-slate-300 bg-white px-2 text-[13px] text-slate-800 outline-none focus:border-blue-600"
            >
              <option value="">All subjects</option>
              {subjectChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>{subjectLabel(choice, activeCase)}</option>
              ))}
            </select>
          ) : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search locations, addresses, perimeters..."
              className="h-9 w-full rounded-[10px] border border-slate-300 bg-white pl-8 pr-3 text-[13px] outline-none focus:border-blue-600"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              ["chronological", "Chronological"],
              ["verified", "Verified First"],
              ["sightings", "Sightings"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSort(key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${sort === key ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {adding ? (
            <div className="space-y-2 rounded-[12px] border border-slate-200 bg-slate-50 p-3">
              <input value={placeName} onChange={(event) => setPlaceName(event.target.value)} placeholder="Location name" className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]" />
              <input value={placeAddress} onChange={(event) => setPlaceAddress(event.target.value)} placeholder="Address" className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]" />
              <input value={placeCoords} onChange={(event) => setPlaceCoords(event.target.value)} placeholder="Lat, lng (optional)" className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]" />
              <select value={placeKind} onChange={(event) => setPlaceKind(event.target.value as SearchLocationKind)} className="h-9 w-full rounded-lg border border-slate-300 px-2 text-[13px]">
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
          {duplicateCount > 0 ? (
            <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[12.5px] font-medium text-amber-950">
                ⚠ {duplicateCount} duplicate location{duplicateCount === 1 ? "" : "s"} detected
                {": "}
                <button type="button" onClick={() => setReviewOpen((open) => !open)} className="font-semibold underline decoration-amber-400 underline-offset-2">
                  Review & Merge
                </button>
              </p>
              {reviewOpen ? (
                <ul className="mt-2 space-y-2">
                  {duplicateClusters.map((cluster) => {
                    const primary = pickPrimary(cluster);
                    return (
                      <li key={cluster.map((row) => row.id).join("-")} className="rounded-lg border border-amber-200 bg-white px-2 py-2 text-[12px] text-amber-950">
                        <div className="font-medium">{primary.name} · primary</div>
                        <div className="mt-1 text-amber-800">{cluster.filter((row) => row.id !== primary.id).map((row) => row.name).join(", ")}</div>
                        <button
                          type="button"
                          disabled={mergingCluster || locationsApi.busy}
                          onClick={() => void mergeCluster(cluster.map((row) => row.id))}
                          className="mt-1.5 h-7 rounded-md bg-amber-700 px-2 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          {mergingCluster ? "Merging…" : "Merge with Primary"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {listed.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-slate-500">
              {subject ? `No locations linked to ${subject.name}.` : "No logged search areas yet. Add a place from Overview or intake."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {listed.map((row) => {
                const related = linkedEvents(row.entity, events, row.latlng);
                const verified = locationVerified(row.entity, related);
                const pin = classifyPin(row.entity, row.kind);
                const Glyph = GLYPH_ICON[pin.glyph];
                const on = focusId === row.entity.id;
                const duplicate = duplicateClusters.some((cluster) => cluster.some((item) => item.id === row.entity.id));
                return (
                  <li key={row.entity.id} className="group relative">
                    <div className={`rounded-[12px] border px-3 py-3 transition-colors ${on ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                      <button type="button" onClick={() => focusOn(row.entity.id, true)} className="w-full pr-16 text-left">
                        <div className="flex items-start gap-2">
                          <Glyph className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT[pin.accent] }} />
                          <div className="min-w-0 flex-1">
                            <div className="whitespace-normal text-[13.5px] font-semibold leading-snug text-slate-900 line-clamp-2">{row.entity.name}</div>
                            <div className="mt-0.5 whitespace-normal text-[12px] leading-snug text-slate-600 line-clamp-2">{row.address}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${verified ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                                {verified ? "Verified" : "Unverified Sighting"}
                              </span>
                              <span className="text-[11px] text-slate-500">{related.length} {related.length === 1 ? "event" : "events"}</span>
                              {duplicate ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">Duplicate</span> : null}
                            </div>
                          </div>
                        </div>
                      </button>
                      <div className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100">
                        <button
                          type="button"
                          onClick={() => focusOn(row.entity.id, true)}
                          className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 shadow-sm hover:border-blue-500"
                        >
                          Focus on Map
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${row.entity.name}`}
                          onClick={() => setDeleteId(row.entity.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 shadow-sm hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {subject && routeStops.length > 0 ? (
        <section className="absolute bottom-8 right-3 z-[500] max-h-[min(42%,360px)] w-[min(320px,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl sm:bottom-auto sm:top-16 sm:max-h-[min(70%,520px)]">
          <header className="sticky top-0 border-b border-slate-200 bg-white px-3 py-2.5">
            <div className={`${mono} text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500`}>Route leg</div>
            <div className="mt-0.5 text-[13.5px] font-semibold leading-snug text-slate-900">{subjectLabel(subject, activeCase)}</div>
          </header>
          <ol className="px-3 py-3">
            {routeStops.map((stop, index) => {
              const next = routeStops[index + 1];
              const segment = stop.latlng && next?.latlng && stop.precise && next.precise
                ? segmentBetween(stop.latlng, next.latlng)
                : null;
              return (
                <li key={stop.placeId} className="relative pl-6">
                  {index < routeStops.length - 1 ? <span className="absolute bottom-0 left-[7px] top-4 w-px bg-slate-300" /> : null}
                  <span className={`absolute left-0 top-1 h-4 w-4 rounded-full border-2 bg-white ${focusId === stop.placeId ? "border-blue-600" : "border-slate-400"}`} />
                  <button type="button" onClick={() => focusOn(stop.placeId, true)} className="w-full pb-1 text-left">
                    <div className={`${mono} text-[12px] text-slate-500`}>{stop.timeLabel}</div>
                    <div className="text-[13px] font-medium leading-snug text-slate-900">{stop.title}</div>
                  </button>
                  {segment ? (
                    <div className={`${mono} pb-3 text-[10.5px] tracking-wide text-slate-500`}>{segment.distance} · {segment.drive}</div>
                  ) : index < routeStops.length - 1 ? (
                    <div className="pb-3 text-[10.5px] text-slate-400">Distance unavailable</div>
                  ) : <div className="pb-1" />}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {focused && popoverStyle ? (
        <LocationPopover
          row={focused}
          events={events}
          activeCase={activeCase}
          style={popoverStyle}
          duplicateClusters={duplicateClusters}
          busy={locationsApi.busy}
          onClose={() => setFocusId(null)}
          onChronology={onViewChronology ? () => onViewChronology(focused.entity.id) : undefined}
          onDelete={() => setDeleteId(focused.entity.id)}
          onMerge={(targetId) => void mergeIntoPrimary(targetId, focused.entity.id)}
        />
      ) : null}

      {deleteTarget ? (
        <div className="absolute inset-0 z-[800] flex items-center justify-center bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-location-title" className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h2 id="delete-location-title" className="text-[15px] font-semibold text-slate-900">Delete location</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              Remove “{deleteTarget.name}” from this case. Chronology events stay on the timeline and are unlinked from this place.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteId(null)} className="h-9 rounded-lg border border-slate-300 px-3 text-[12.5px] font-medium text-slate-700">
                Cancel
              </button>
              <button type="button" disabled={locationsApi.busy} onClick={() => void confirmDelete()} className="h-9 rounded-lg bg-rose-700 px-3 text-[12.5px] font-semibold text-white disabled:opacity-40">
                Delete location
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LocationPopover({
  row,
  events,
  activeCase,
  style,
  duplicateClusters,
  busy,
  onClose,
  onChronology,
  onDelete,
  onMerge,
}: {
  row: MappedPlace;
  events: TimelineEventRecord[];
  activeCase: CaseRecord;
  style: { left: number; top: number; transform?: string };
  duplicateClusters: EntityRecord[][];
  busy: boolean;
  onClose: () => void;
  onChronology?: () => void;
  onDelete: () => void;
  onMerge: (targetId: string) => void;
}) {
  const related = linkedEvents(row.entity, events, row.latlng);
  const verified = locationVerified(row.entity, related);
  const cluster = duplicateClusters.find((group) => group.some((item) => item.id === row.entity.id));
  const primary = cluster ? pickPrimary(cluster) : null;
  const canMerge = Boolean(primary && primary.id !== row.entity.id);
  return (
    <article className="absolute z-[650] w-[300px] rounded-2xl border border-slate-200 bg-white shadow-2xl" style={style}>
      <header className="border-b border-slate-100 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold leading-snug text-slate-900">{row.entity.name}</h2>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-600">{row.address}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-[11px] font-medium text-slate-400 hover:text-slate-700">Close</button>
        </div>
        <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${verified ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
          {verified ? "Verified" : "Unverified Sighting"}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-px bg-slate-100">
        <Metric label="Coordinates" value={row.precise ? `${row.latlng.lat.toFixed(5)}, ${row.latlng.lng.toFixed(5)}` : "Approximate"} />
        <Metric label="Associated Events" value={String(related.length)} />
        <Metric label="Source" value={sourceLabel(related, activeCase)} />
        <Metric label="Last Activity" value={lastActivity(related, row.dateLogged)} />
      </dl>
      <footer className="flex flex-col gap-1.5 px-3 py-3">
        {onChronology ? (
          <button type="button" onClick={onChronology} className="h-8 rounded-lg bg-slate-900 text-[12px] font-semibold text-white">
            View in Chronology
          </button>
        ) : null}
        <button type="button" onClick={onDelete} className="h-8 rounded-lg border border-rose-200 text-[12px] font-medium text-rose-700 hover:bg-rose-50">
          Delete Location
        </button>
        {canMerge && primary ? (
          <button type="button" disabled={busy} onClick={() => onMerge(primary.id)} className="h-8 rounded-lg border border-amber-300 bg-amber-50 text-[12px] font-semibold text-amber-900 disabled:opacity-40">
            Merge with Primary
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-2">
      <dt className={`${mono} text-[9.5px] uppercase tracking-[0.12em] text-slate-400`}>{label}</dt>
      <dd className="mt-0.5 text-[12px] font-medium leading-snug text-slate-800">{value}</dd>
    </div>
  );
}
