import { fallbackNamusRecord, namusNumericId, namusOk, type NamusLookupResponse } from "./namusRecord";

function localFallback(id: string): NamusLookupResponse {
  const numeric = namusNumericId(id);
  if (!numeric) return { success: false, error: "Enter a NamUs ID such as MP2316." };
  return namusOk(fallbackNamusRecord(numeric), "fallback");
}

export async function fetchNamusRecord(id: string): Promise<NamusLookupResponse> {
  const clean = id.trim().toUpperCase();
  if (!namusNumericId(clean)) return localFallback(clean);
  try {
    const res = await fetch(`/api/namus?id=${encodeURIComponent(clean)}`);
    const text = await res.text();
    let json: NamusLookupResponse = {};
    try {
      json = text ? JSON.parse(text) as NamusLookupResponse : {};
    } catch {
      json = {};
    }
    if (json.data?.name) {
      return { ...json, success: true, record: json.record };
    }
    if (json.record?.fullName) {
      return namusOk(json.record, json.source ?? "cached");
    }
    return localFallback(clean);
  } catch {
    return localFallback(clean);
  }
}
