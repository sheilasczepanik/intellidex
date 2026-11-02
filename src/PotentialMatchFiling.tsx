import { useState } from "react";
import { ClipboardCopy, Send } from "lucide-react";
import { updateCase, type CaseRecord } from "./db";
import { formatPotentialMatch, validatePotentialMatch, type MatchAudience } from "./lib/potentialMatch";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

export default function PotentialMatchFiling({ activeCase }: { activeCase: CaseRecord }) {
  const saved = activeCase.potentialMatch;
  const [title, setTitle] = useState(saved?.title || "");
  const [body, setBody] = useState(saved?.body || "");
  const [audience, setAudience] = useState<MatchAudience>(saved?.audience || "state_researcher");
  const [formatted, setFormatted] = useState(saved?.formatted || "");
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const prepare = async () => {
    const check = validatePotentialMatch(title, body);
    setErrors(check.errors);
    setCopied(false);
    if (!check.ok) {
      setFormatted("");
      return;
    }
    const packet = formatPotentialMatch({
      title,
      body,
      audience,
      doeNetworkId: activeCase.doeNetworkId,
    });
    setFormatted(packet);
    setSaving(true);
    try {
      await updateCase(activeCase.id, {
        potentialMatch: {
          title: title.trim(),
          body: body.trim(),
          audience,
          formatted: packet,
          updatedAt: new Date().toISOString(),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!formatted) return;
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
  };

  return (
    <section className="mb-8 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>POTENTIAL MATCH FILING</h2>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          Doe Network submission
        </span>
      </div>
      <p className="mb-4 max-w-[68ch] text-[13px] leading-relaxed text-slate-500">
        Case numbers belong in the title. Case links belong in the body. The packet is formatted for a state researcher or coordinator. A Charley Project page stays secondary until a NamUs, agency, or Doe Network link is included.
      </p>
      <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Title</label>
      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); setFormatted(""); }}
        placeholder="93DMFL × NamUs MP123456"
        className={`${inputCls} mb-3 h-11`}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {([
          ["state_researcher", "State researcher"],
          ["coordinator", "Area coordinator"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setAudience(id); setFormatted(""); }}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium ${audience === id ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Body</label>
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); setFormatted(""); }}
        placeholder={"Compare the two public records and paste the case links.\nhttps://www.namus.gov/MissingPersons/Case#/123456"}
        className={`${inputCls} mb-3 h-28 resize-none py-2.5 leading-relaxed`}
      />
      {errors.length > 0 && (
        <ul className="mb-3 space-y-1 text-[12.5px] text-rose-700">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-slate-900 px-4 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {saving ? "Saving packet…" : "Format for submission"}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!formatted}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy packet"}
        </button>
      </div>
      {formatted && (
        <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-800">{formatted}</pre>
      )}
    </section>
  );
}
