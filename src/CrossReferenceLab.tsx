import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ClipboardCopy, Link2, Waypoints } from "lucide-react";
import {
  db,
  deleteCaseMatchLink,
  linkCasesAsMatch,
  setMatchLinkStatus,
  updateCase,
  type CaseRecord,
  type MatchLinkStatus,
} from "./db";
import { MATCH_STATUS_LABEL, pairKey } from "./lib/caseMatch";
import { caseKindLabel, compareCases, type Overlap } from "./lib/crossReference";

const mono = "font-mono";

const overlapClass: Record<Overlap, string> = {
  match: "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200",
  close: "bg-amber-50 text-amber-950 ring-1 ring-amber-200",
  unique: "bg-white text-slate-800",
  empty: "bg-slate-50 text-slate-400",
};

export default function CrossReferenceLab({
  cases,
  onBack,
  onOpenCase,
}: {
  cases: CaseRecord[];
  onBack: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState("");
  const evidence = useLiveQuery(() => db.evidence.toArray(), []) ?? [];
  const links = useLiveQuery(() => db.caseMatchLinks.toArray(), []) ?? [];
  const selected = cases.filter((row) => picked.includes(row.id));
  const matrix = useMemo(() => (selected.length >= 2 ? compareCases(selected) : null), [selected]);

  const toggle = (id: string) => {
    setPicked((cur) => cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]);
  };

  const copy = async (id: string, text: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(id);
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 sm:px-6 sm:pt-13 lg:px-10">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        Hub
      </button>
      <div className={`mb-5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>HUB / CROSS-REFERENCE LAB</div>
      <h1 className="mb-3 flex items-center gap-3 text-[28px] font-semibold tracking-tight sm:text-[40px]">
        <Waypoints className="h-7 w-7 text-slate-700" />
        Cross-reference lab
      </h1>
      <p className="mb-6 max-w-4xl text-[15px] leading-relaxed text-slate-500">
        Select a disappeared case and an unidentified case, or any two or more files. Shared height, age, hair, eyes, marks, places, and the gap between a missing date and a recovery date are highlighted in the matrix.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {cases.map((row) => {
          const on = picked.includes(row.id);
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => toggle(row.id)}
              className={`rounded-full border px-3 py-1.5 text-left text-[12.5px] font-medium ${on ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}
            >
              <span className={`${mono} mr-1.5 text-[10px] tracking-wide text-slate-500`}>{row.doeNetworkId || row.fileIdentifier || row.id}</span>
              {row.subjectName || row.title}
            </button>
          );
        })}
      </div>

      {selected.length < 2 ? (
        <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-[13px] text-slate-500">
          Choose at least two cases to build the trait matrix.
        </div>
      ) : matrix && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-900 ring-1 ring-emerald-200">Match</span>
            <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-950 ring-1 ring-amber-200">Close</span>
            <span className="rounded-md bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">Only on one case</span>
          </div>
          <div className="mb-6 overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className={`px-3 py-3 ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>TRAIT</th>
                  {selected.map((row) => (
                    <th key={row.id} className="px-3 py-3 font-semibold text-slate-900">
                      <button type="button" onClick={() => onOpenCase(row.id)} className="text-left hover:text-blue-700">
                        <div>{row.subjectName || row.title}</div>
                        <div className={`mt-0.5 ${mono} text-[10px] font-medium tracking-wide text-slate-500`}>{caseKindLabel(row)}</div>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((trait) => (
                  <tr key={trait.key} className="border-b border-slate-100 last:border-0">
                    <th className="px-3 py-2.5 text-[12px] font-semibold text-slate-600">{trait.label}</th>
                    {trait.cells.map((cell, index) => (
                      <td key={selected[index].id} className="px-2 py-2">
                        <div className={`rounded-lg px-2.5 py-2 ${overlapClass[cell.overlap]}`}>{cell.value}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="mb-8 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
            <h2 className={`mb-2 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>TIMELINE GAPS</h2>
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-700">
              {matrix.gaps.map((gap) => <li key={gap}>{gap}</li>)}
            </ul>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {selected.map((row) => (
                <RecoveryFields key={row.id} row={row} />
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>POTENTIAL MATCH PAIRS</h2>
            {pairings(selected).map(([a, b]) => {
              const link = links.find((item) => item.pairKey === pairKey(a.id, b.id));
              return (
                <article key={pairKey(a.id, b.id)} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[14px] font-semibold text-slate-900">
                      {(a.subjectName || a.title)} × {(b.subjectName || b.title)}
                    </div>
                    {link ? (
                      <select
                        value={link.status}
                        onChange={(e) => void setMatchLinkStatus(link.id, e.target.value as MatchLinkStatus)}
                        className="h-8 rounded-[8px] border border-slate-300 bg-white px-2 text-[12px]"
                      >
                        {(Object.keys(MATCH_STATUS_LABEL) as MatchLinkStatus[]).map((status) => (
                          <option key={status} value={status}>{MATCH_STATUS_LABEL[status]}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void linkCasesAsMatch(a.id, b.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-slate-900 px-3 text-[12px] font-semibold text-white"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Link as Potential Match
                      </button>
                    )}
                  </div>
                  {link && (
                    <>
                      <p className="mb-2 text-[12.5px] text-slate-500">
                        Title carries both case numbers. The body carries source links from the two vaults. Status: {MATCH_STATUS_LABEL[link.status]}.
                      </p>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-800">
                        {link.formatted || link.body || "Add a NamUs, agency, or article link on either case before this packet can be exported."}
                      </pre>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!link.formatted}
                          onClick={() => void copy(link.id, link.formatted)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-slate-300 px-3 text-[12px] font-medium text-slate-700 disabled:opacity-40"
                        >
                          <ClipboardCopy className="h-3.5 w-3.5" />
                          {copied === link.id ? "Copied" : "Copy Doe Network packet"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteCaseMatchLink(link.id)}
                          className="h-8 rounded-[8px] px-3 text-[12px] font-medium text-slate-500 hover:text-slate-800"
                        >
                          Remove link
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

function pairings(cases: CaseRecord[]) {
  const pairs: [CaseRecord, CaseRecord][] = [];
  for (let i = 0; i < cases.length; i += 1) {
    for (let j = i + 1; j < cases.length; j += 1) pairs.push([cases[i], cases[j]]);
  }
  return pairs;
}

function RecoveryFields({ row }: { row: CaseRecord }) {
  const [place, setPlace] = useState(row.recoveryLocation || "");
  const [when, setWhen] = useState(toLocal(row.recoveryAt || ""));
  return (
    <form
      className="rounded-[10px] border border-slate-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void updateCase(row.id, { recoveryLocation: place.trim(), recoveryAt: when });
      }}
    >
      <div className="mb-2 text-[12px] font-semibold text-slate-700">Recovery for {row.subjectName || row.title}</div>
      <input
        value={place}
        onChange={(e) => setPlace(e.target.value)}
        placeholder="Recovery location"
        className="mb-2 h-9 w-full rounded-[8px] border border-slate-300 px-2 text-[12.5px] outline-none focus:border-blue-600"
      />
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="mb-2 h-9 w-full rounded-[8px] border border-slate-300 px-2 text-[12.5px] outline-none focus:border-blue-600"
      />
      <button type="submit" className="h-8 rounded-[8px] bg-slate-900 px-3 text-[12px] font-semibold text-white">Save recovery</button>
    </form>
  );
}

function toLocal(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
