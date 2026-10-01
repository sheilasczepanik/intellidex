import { NAMUS_MP54, namusOk, type NamusLookupResponse } from "./namusRecord";

export async function fetchNamusRecord(id: string): Promise<NamusLookupResponse> {
  try {
    const res = await fetch(`/api/namus?id=${encodeURIComponent(id.trim())}`);
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
    if (!res.ok) {
      return namusOk(NAMUS_MP54, "cached");
    }
    return json.success === false
      ? json
      : namusOk(NAMUS_MP54, "cached");
  } catch {
    return namusOk(NAMUS_MP54, "cached");
  }
}
