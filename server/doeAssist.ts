import OpenAI from "openai";
import {
  coerceDoeRecord,
  mergeDoeRecords,
  parseDoePaste,
  type AssistedDoeRecord,
} from "../src/lib/doeNetworkPaste.ts";

const SYSTEM = `You extract a Doe Network missing or unidentified person profile from text a researcher pasted.
Return a JSON object with exactly these string fields:
fullName, doeNetworkId, sex, race, ageAtDisappearance, currentAge, dateOfBirth, height, weight, hair, eyes, distinguishingMarks, clothing, medicalAlerts, dateLastSeen, location, circumstances, caseNotes.
Use an empty string when the paste does not state the fact. Do not infer or add people, dates, or places that are absent from the paste.
doeNetworkId is the Doe Network case token, such as 93DMFL or 1187UMFL, when one is present.
dateOfBirth and dateLastSeen use YYYY-MM-DD when a full calendar date is present; otherwise keep the verbatim date phrase.`;

export async function assistDoeProfile(input: {
  text: string;
  url?: string;
  apiKey: string;
  model?: string;
}): Promise<{ engine: "gpt-4o" | "local"; record: AssistedDoeRecord }> {
  const local = parseDoePaste(input.text, input.url || "");
  const key = input.apiKey.trim();
  if (!key) return { engine: "local", record: local };
  try {
    const client = new OpenAI({ apiKey: key });
    const completion = await client.chat.completions.create({
      model: input.model || "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: [input.url ? `Reference URL: ${input.url}` : "", input.text].filter(Boolean).join("\n\n").slice(0, 24_000) },
      ],
    });
    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as unknown;
    return { engine: "gpt-4o", record: mergeDoeRecords(coerceDoeRecord(parsed), local) };
  } catch (err) {
    console.error("[doe-assist] GPT-4o parse failed", err instanceof Error ? err.message : err);
    return { engine: "local", record: local };
  }
}
