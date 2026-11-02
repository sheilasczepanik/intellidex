import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { getLocalApiKey } from "./lib/settings";
import { namusIdFromUrl, recordHasFacts, type AssistedNamusRecord } from "./lib/namusPaste";

const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600";

export type NamusAssistResult = {
  record: AssistedNamusRecord;
  rawText: string;
  url: string;
  engine: "gpt-4o" | "local";
  warning?: string;
};

export default function AssistedNamusDrawer({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (result: NamusAssistResult) => Promise<void> | void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  if (!open) return null;

  const run = async () => {
    const rawText = text.trim();
    const profileUrl = url.trim();
    if (!rawText) {
      setError("Paste the NamUs profile text. The public page is rendered in the browser, so a URL alone cannot be read.");
      setNote("");
      return;
    }
    if (profileUrl && !/^https?:\/\//i.test(profileUrl)) {
      setError("The NamUs URL needs to start with https://");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const key = getLocalApiKey();
      if (key) headers["x-dossier-key"] = key;
      const res = await fetch("/api/namus-assist", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: profileUrl, text: rawText }),
      });
      const json = await res.json() as { record?: AssistedNamusRecord; engine?: string; error?: string; warning?: string };
      if (!res.ok) {
        setError(json.error || "The profile could not be structured.");
        return;
      }
      if (!json.record || !recordHasFacts(json.record)) {
        setError(json.warning || "No demographic fields were found in that paste.");
        return;
      }
      const engine = json.engine === "gpt-4o" ? "gpt-4o" : "local";
      if (!json.record.namusId && profileUrl) json.record.namusId = namusIdFromUrl(profileUrl);
      await onApply({ record: json.record, rawText, url: profileUrl, engine, warning: json.warning });
      setNote(engine === "gpt-4o"
        ? "Structured with GPT-4o from the pasted profile."
        : "Structured from the pasted text on this machine. GPT-4o was unavailable, so labeled fields were read locally.");
    } catch {
      setError("The profile could not be structured.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[440px] flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="font-mono text-[11px] tracking-[0.14em] text-slate-500">ASSISTED NAMUS INGESTION</div>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight">Paste a NamUs profile</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
            NamUs public pages are client-rendered, so this drawer reads the text you paste. GPT-4o turns that text into demographics, physical characteristics, dates, and case notes on the local case record.
          </p>
          <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">NamUs URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.namus.gov/MissingPersons/Case#/…"
            className={`${inputCls} mb-3 h-11`}
          />
          <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Profile text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Name: Jordan Hale\nNamUs # MP123456\nHeight: 5'11\"\nDate of last contact: 02/09/2004\nCity: Baton Rouge\nState: Louisiana\nCircumstances: Last seen leaving a residence."}
            className={`${inputCls} h-56 resize-none py-2.5 leading-relaxed`}
          />
          {error && <p className="mt-3 text-[12.5px] text-rose-700">{error}</p>}
          {note && <p className="mt-3 text-[12.5px] text-emerald-800">{note}</p>}
        </div>
        <div className="border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? "Reading profile…" : "Structure into this case"}
          </button>
        </div>
      </aside>
    </div>
  );
}
