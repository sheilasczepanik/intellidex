export type LatLng = { lat: number; lng: number };

const cache = new Map<string, LatLng | null>();

export function parseCoordinates(raw?: string | null): LatLng | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const numbered = text.match(/(-?\d+(?:\.\d+)?)\s*[°º]?\s*([NSns])?[,\s;/]+(-?\d+(?:\.\d+)?)\s*[°º]?\s*([EWew])?/);
  if (!numbered) return null;
  let lat = Number(numbered[1]);
  let lng = Number(numbered[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const ns = (numbered[2] || "").toUpperCase();
  const ew = (numbered[4] || "").toUpperCase();
  if (ns === "S") lat = -Math.abs(lat);
  if (ns === "N") lat = Math.abs(lat);
  if (ew === "W") lng = -Math.abs(lng);
  if (ew === "E") lng = Math.abs(lng);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export async function geocodeQuery(query: string): Promise<LatLng | null> {
  const q = query.trim();
  if (!q) return null;
  if (cache.has(q.toLowerCase())) return cache.get(q.toLowerCase()) ?? null;
  const parsed = parseCoordinates(q);
  if (parsed) {
    cache.set(q.toLowerCase(), parsed);
    return parsed;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      cache.set(q.toLowerCase(), null);
      return null;
    }
    const rows = (await res.json()) as { lat: string; lon: string }[];
    const hit = rows[0];
    if (!hit) {
      cache.set(q.toLowerCase(), null);
      return null;
    }
    const loc = { lat: Number(hit.lat), lng: Number(hit.lon) };
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
      cache.set(q.toLowerCase(), null);
      return null;
    }
    cache.set(q.toLowerCase(), loc);
    return loc;
  } catch {
    cache.set(q.toLowerCase(), null);
    return null;
  }
}

export function metersBetween(a: LatLng, b: LatLng) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function jitterLatLng(id: string, origin: LatLng): LatLng {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const dlat = (((h >>> 8) % 90) - 45) * 0.00035;
  const dlng = (((h >>> 16) % 90) - 45) * 0.00035;
  return { lat: origin.lat + dlat, lng: origin.lng + dlng };
}
