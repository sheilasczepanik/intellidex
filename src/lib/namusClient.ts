import { knownNamusRecord, namusNumericId, namusOk, type NamusLookupResponse } from "./namusRecord";

const BLOCKED = "NamUs did not return a readable profile. Paste the profile text to fill this case.";

function blocked(message = BLOCKED): NamusLookupResponse {
  return { success: false, blocked: true, error: message };
}

function realName(name?: string) {
  const value = (name || "").trim();
  return Boolean(value) && !/^NamUs (Subject|MP)\b/i.test(value);
}

export async function fetchNamusRecord(id: string): Promise<NamusLookupResponse> {
  const clean = id.trim();
  const numeric = namusNumericId(clean);
  if (!numeric) return { success: false, error: "Enter a NamUs ID such as MP2316, or a NamUs case URL." };
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
    if (realName(json.data?.name)) return { ...json, success: true };
    if (realName(json.record?.fullName) && json.record) return namusOk(json.record, json.source ?? "live");
    return blocked(json.error || BLOCKED);
  } catch {
    return blocked();
  }
}
