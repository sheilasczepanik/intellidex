import { fallbackNamusRecord, knownNamusRecord, namusNumericId, namusOk, type NamusLookupResponse } from "./namusRecord";

function localFallback(id: string): NamusLookupResponse {
  const numeric = namusNumericId(id);
  if (!numeric) return { success: false, error: "Enter a NamUs ID such as MP2316." };
  return namusOk(knownNamusRecord(numeric) || fallbackNamusRecord(numeric), knownNamusRecord(numeric) ? "cached" : "fallback");
}

export async function fetchNamusRecord(id: string): Promise<NamusLookupResponse> {
  const clean = id.trim().toUpperCase();
  const numeric = namusNumericId(clean);
  if (!numeric) return localFallback(clean);
  const known = knownNamusRecord(numeric);
  if (known) return namusOk(known, "cached");
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
