import type { NamusLookupResponse } from "./namusRecord";

export async function fetchNamusRecord(id: string): Promise<NamusLookupResponse> {
  const res = await fetch(`/api/namus?id=${encodeURIComponent(id.trim())}`);
  const text = await res.text();
  let json: NamusLookupResponse = {};
  try {
    json = text ? JSON.parse(text) as NamusLookupResponse : {};
  } catch {
    json = {};
  }
  if (!res.ok && !json.record) {
    return { error: json.error || `NamUs lookup failed (${res.status})` };
  }
  return json;
}
