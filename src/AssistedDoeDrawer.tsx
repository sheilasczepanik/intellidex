import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getLocalApiKey } from "./lib/settings";
import {
  doeIdFromText,
  doeRecordHasFacts,
  parseDoePaste,
  type AssistedDoeRecord,
} from "./lib/doeNetworkPaste";

const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600";

export type DoeAssistResult = {
  record: AssistedDoeRecord;
  rawText: string;
  url: string;
  engine: "gpt-4o" | "local";
  warning?: string;
};

export default function AssistedDoeDrawer({
  open,
  initialUrl = "",
  onClose,
  onApply,
}: {
  open: boolean;
  initialUrl?: string;
  onClose: () => void;
  onApply: (result: DoeAssistResult) => Promise<void> | void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl);
    setText("");
    setError("");
    setDragOver(false);
    setBusy(false);
  }, [open, initialUrl]);

  if (!open) return null;

  const absorb = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const found = trimmed.match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/, "") || "";
    const rest = found ? trimmed.replace(found, "").trim() : trimmed;
    if (found) setUrl(found);
    if (rest && !/^https?:\/\//i.test(rest)) {
      setText((current) => current.trim() ? `${current.trim()}\n${rest}` : rest);
    }
    setError("");
  };

  const extract = async () => {
    const rawText = text.trim();
    const profileUrl = url.trim();
    if (!rawText) {
      setError("Paste the profile text copied from the Doe Network page.");
      return;
    }
    if (profileUrl && !/^https?:\/\//i.test(profileUrl)) {
      setError("The Doe Network URL needs to start with https://");
      return;
    }
    setBusy(true);
    setError("");
    const local = parseDoePaste(rawText, profileUrl);
    let result: DoeAssistResult = { record: local, rawText, url: profileUrl, engine: "local" };
    try {
      const response = await fetch("/api/doe-assist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-dossier-key": getLocalApiKey(),
        },
        body: JSON.stringify({ text: rawText, url: profileUrl }),
      });
      const payload = await response.json() as { record?: AssistedDoeRecord; engine?: "gpt-4o" | "local"; warning?: string; error?: string };
      if (payload.record && doeRecordHasFacts(payload.record)) {
        if (!payload.record.doeNetworkId) payload.record.doeNetworkId = doeIdFromText(profileUrl);
        result = {
          record: payload.record,
          rawText,
          url: profileUrl,
          engine: payload.engine === "gpt-4o" ? "gpt-4o" : "local",
          warning: payload.warning,
        };
      } else if (payload.error) {
        setError(payload.error);
        setBusy(false);
        return;
      }
    } catch {
      result = { record: local, rawText, url: profileUrl, engine: "local" };
    }
    if (!doeRecordHasFacts(result.record)) {
      setError("No demographic fields were found in that paste.");
      setBusy(false);
      return;
    }
    await onApply(result);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-labelledby="doe-paste-title"
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-[560px] flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="font-mono text-[11px] tracking-[0.14em] text-slate-500">DOE NETWORK</div>
            <h2 id="doe-paste-title" className="mt-1 text-[18px] font-semibold tracking-tight">Assisted Doe Network Ingest</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
            Drop a Doe Network profile URL, the text copied from the case page, or both. Extract sends that text through GPT-4o and fills the case form. The page itself is not fetched.
          </p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              absorb(e.dataTransfer.getData("text/plain"));
            }}
            className={`rounded-[12px] border-2 border-dashed p-3 ${dragOver ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50"}`}
          >
            <p className="mb-3 text-[12px] font-medium text-slate-500">Assisted Doe Network Ingest drop zone</p>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700" htmlFor="doe-profile-url">Doe Network URL</label>
            <input
              id="doe-profile-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (!/https?:\/\//i.test(pasted) || pasted.trim().split(/\s+/).length > 1) return;
                e.preventDefault();
                absorb(pasted);
              }}
              placeholder="https://www.doenetwork.org/cases/…"
              className={`${inputCls} mb-4 h-11`}
            />
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700" htmlFor="doe-profile-text">Profile text</label>
            <textarea
              id="doe-profile-text"
              value={text}
              onChange={(e) => { setText(e.target.value); setError(""); }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (!/https?:\/\//i.test(pasted)) return;
                e.preventDefault();
                absorb(pasted);
              }}
              placeholder={"Paste the profile copied from the Doe Network.\n\nCase File\n93DMFL\nName\nJordan Hale\nAge\n34\nMissing Since\nFebruary 9, 2004\nLocation\nBaton Rouge, Louisiana"}
              className="h-56 w-full resize-none bg-transparent px-1 py-1 text-[13.5px] leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          {error && <p className="mt-3 text-[12.5px] text-rose-700">{error}</p>}
        </div>
        <div className="border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={() => void extract()}
            disabled={busy}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? "Extracting profile…" : "Extract & Populate Case File"}
          </button>
        </div>
      </section>
    </div>
  );
}
