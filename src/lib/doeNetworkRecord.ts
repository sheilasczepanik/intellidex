import { parseDoeNetworkId } from "./doeNetworkId";

export type DoeNetworkFixture = {
  doeNetworkId: string;
  name: string;
  lksDate: string;
  location: string;
  sex: string;
  ageAtDisappearance: string;
  currentAge: string;
  height: string;
  weight: string;
  hair: string;
  eyes: string;
  distinguishingMarks: string;
  clothing: string;
  medicalAlerts: string;
  circumstances: string;
};

/** Local Doe Network profiles. Lookup never requests the Doe Network site. */
export const KNOWN_DOE_CASES: Record<string, DoeNetworkFixture> = {};

export function knownDoeRecord(raw: string): DoeNetworkFixture | null {
  const parsed = parseDoeNetworkId(raw);
  if (!parsed) return null;
  return KNOWN_DOE_CASES[parsed.id] || null;
}
