import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, setEvidenceLinkedCases, type CaseRecord, type EvidenceRecord } from "./db";

const mono = "font-mono";

export default function ConnectedEvidence({
  activeCase,
  evidence,
}: {
  activeCase: CaseRecord;
  evidence: EvidenceRecord[];
}) {
  const cases = useLiveQuery(() => db.cases.toArray(), []) ?? [];
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const inbound = useLiveQuery(
    () => db.evidence.where("linkedCaseIds").equals(activeCase.id).toArray(),
    [activeCase.id],
  ) ?? [];
  const others = cases.filter((row) => row.id !== activeCase.id);
  const ownedShared = evidence.filter((row) => (row.linkedCaseIds || []).length > 0);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const rows = [...inbound, ...ownedShared.filter((row) => !inbound.some((item) => item.id === row.id))];
    if (!needle) return rows;
    return rows.filter((row) => `${row.fileName} ${row.originalFileName || ""} ${row.fullText || row.rawText} ${row.sourceUrl || ""}`.toLowerCase().includes(needle));
  }, [inbound, ownedShared, needle]);

  const chooseSource = (id: string) => {
    setSourceId(id);
    const row = evidence.find((item) => item.id === id);
    setTargets(row?.linkedCaseIds || []);
  };

  const save = async () => {
    if (!sourceId) return;
    await setEvidenceLinkedCases(sourceId, targets);
  };

  return (
    <section className="mb-8 rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${mono} text-[11px] tracking-[0.14em] text-slate-500`}>CONNECTED EVIDENCE</h2>
        <span className="text-[12px] text-slate-500">{visible.length} shared {visible.length === 1 ? "item" : "items"}</span>
      </div>
      <p className="mb-4 max-w-[70ch] text-[13px] leading-relaxed text-slate-500">
        Tag an article, news clip, or clue onto every case it mentions. It stays in the original vault and appears in each tagged case’s drawer and search.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search connected headlines, clips, and clues"
        className="mb-4 h-10 w-full rounded-[10px] border border-slate-300 px-3 text-[13px] outline-none focus:border-blue-600"
      />
      <div className="mb-4 rounded-[10px] border border-slate-200 p-3">
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Tag an item from this case</label>
        <select
          value={sourceId}
          onChange={(e) => chooseSource(e.target.value)}
          className="mb-2 h-9 w-full rounded-[8px] border border-slate-300 bg-white px-2 text-[12.5px]"
        >
          <option value="">Select evidence…</option>
          {evidence.map((row) => (
            <option key={row.id} value={row.id}>{row.originalFileName || row.fileName}</option>
          ))}
        </select>
        {sourceId && (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {others.map((row) => {
                const on = targets.includes(row.id);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setTargets((cur) => on ? cur.filter((id) => id !== row.id) : [...cur, row.id])}
                    className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${on ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-600"}`}
                  >
                    {row.doeNetworkId || row.fileIdentifier || row.id} · {row.subjectName || row.title}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => void save()} className="h-8 rounded-[8px] bg-slate-900 px-3 text-[12px] font-semibold text-white">
              Save tags
            </button>
          </>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-slate-300 px-4 py-6 text-center text-[13px] text-slate-500">
          No articles or clues are tagged across cases yet.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-[10px] border border-slate-200">
          {visible.map((row) => {
            const owner = cases.find((item) => item.id === row.caseId);
            const sharedWith = (row.linkedCaseIds || []).map((id) => cases.find((item) => item.id === id)?.subjectName || cases.find((item) => item.id === id)?.title || id);
            const inboundHere = row.caseId !== activeCase.id;
            return (
              <li key={row.id} className="px-3 py-2.5">
                <div className="text-[13.5px] font-semibold text-slate-900">{row.originalFileName || row.fileName}</div>
                <div className="mt-0.5 text-[12px] text-slate-500">
                  {inboundHere ? `From ${owner?.subjectName || owner?.title || row.caseId}` : `Shared onward · ${sharedWith.join(", ") || "—"}`}
                  {row.sourceUrl ? ` · ${row.sourceUrl}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
