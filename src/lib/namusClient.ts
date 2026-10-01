import { namusOk, type NamusLookupResponse } from "./namusRecord";

export async function fetchNamusRecord(id: string): Promise<NamusLookupResponse> {
  const clean = id.trim().toUpperCase();
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
    if (json.success === false) return json;
    return { success: false, error: clean ? `No NamUs record found for ${clean}.` : "Enter a NamUs ID." };
  } catch {
    return { success: false, error: "NamUs lookup failed." };
  }
}
