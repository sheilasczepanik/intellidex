import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { namusIdFromUrl, parseNamusPaste, recordHasFacts, type AssistedNamusRecord } from "./lib/namusPaste";

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
  initialUrl = "",
  onClose,
  onApply,
}: {
  open: boolean;
  initialUrl?: string;
  onClose: () => void;
  onApply: (result: NamusAssistResult) => Promise<void> | void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl);
    setText("");
    setError("");
    setDragOver(false);
  }, [open, initialUrl]);

  if (!open) return null;

  const extract = () => {
    const rawText = text.trim();
    const profileUrl = url.trim();
    if (!rawText) {
      setError("Paste the profile text copied from the NamUs page.");
      return;
    }
    if (profileUrl && !/^https?:\/\//i.test(profileUrl)) {
      setError("The NamUs URL needs to start with https://");
      return;
    }
    const record = parseNamusPaste(rawText, profileUrl);
    if (!record.namusId) record.namusId = namusIdFromUrl(profileUrl);
    if (!recordHasFacts(record)) {
      setError("No demographic fields were found in that paste.");
      return;
    }
    void onApply({ record, rawText, url: profileUrl, engine: "local" });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-labelledby="namus-paste-title"
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-[560px] flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="font-mono text-[11px] tracking-[0.14em] text-slate-500">NAMUS PROFILE</div>
            <h2 id="namus-paste-title" className="mt-1 text-[18px] font-semibold tracking-tight">Paste a NamUs profile</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
            Paste the NamUs URL for reference, then paste the profile text copied from the page. Extract reads that text on this machine and fills the case file. The page itself is not fetched.
          </p>
          <label className="mb-1.5 block text-[12px] font-semibold text-slate-700" htmlFor="namus-profile-url">NamUs URL</label>
          <input
            id="namus-profile-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.namus.gov/MissingPersons/Case#/…"
            className={`${inputCls} mb-4 h-11`}
          />
          <label className="mb-1.5 block text-[12px] font-semibold text-slate-700" htmlFor="namus-profile-text">Profile text</label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.getData("text/plain").trim();
              if (!dropped) return;
              setText((current) => current.trim() ? `${current.trim()}\n${dropped}` : dropped);
              setError("");
            }}
            className={`rounded-[12px] border-2 border-dashed p-2 ${dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
          >
            <textarea
              id="namus-profile-text"
              value={text}
              onChange={(e) => { setText(e.target.value); setError(""); }}
              placeholder={"Paste the profile copied from NamUs.\n\nMissing Person\nJordan Hale\nSex\nMale\nAge at disappearance\n34 Years\nDate of Last Contact\nFebruary 9, 2004\nCity\nBaton Rouge\nState\nLouisiana"}
              className="h-64 w-full resize-none bg-transparent px-2 py-2 text-[13.5px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          {error && <p className="mt-3 text-[12.5px] text-rose-700">{error}</p>}
        </div>
        <div className="border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={extract}
            className="inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-blue-600 text-[13.5px] font-semibold text-white hover:bg-blue-700"
          >
            Extract & Populate Case File
          </button>
        </div>
      </section>
    </div>
  );
}
