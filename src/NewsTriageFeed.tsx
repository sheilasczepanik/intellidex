import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Newspaper, RefreshCw } from "lucide-react";
import { addEvidence, db, type CaseRecord } from "./db";
import {
  fetchNewsTriage,
  isGoogleAlertFeed,
  loadCustomAlertFeeds,
  LOUISIANA_ALERT_QUERIES,
  matchNewsToCases,
  saveCustomAlertFeeds,
  type NewsTriageItem,
} from "./lib/newsTriage";

const mono = "font-mono";

function relativeTime(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (Math.abs(min) < 60) return `${Math.max(min, 0)}m ago`;
  const hrs = Math.round(min / 60);
  if (Math.abs(hrs) < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function NewsTriageFeed({
  cases,
  onBack,
  onOpenCase,
}: {
  cases: CaseRecord[];
  onBack: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const [items, setItems] = useState<NewsTriageItem[]>([]);
  const [offline, setOffline] = useState(false);
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState<string>("all");
  const [feeds, setFeeds] = useState(() => loadCustomAlertFeeds().join("\n"));
  const [feedError, setFeedError] = useState("");
  const [filingId, setFilingId] = useState("");

  const refresh = async (persistFeeds = false) => {
    const lines = feeds.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const saved = lines.length ? lines : loadCustomAlertFeeds();
    if (persistFeeds) {
      const invalid = lines.find((line) => !isGoogleAlertFeed(line));
      if (invalid) {
        setFeedError("Custom feeds must be https://www.google.com/alerts/feeds/… links.");
        return;
      }
      saveCustomAlertFeeds(lines);
      setFeedError("");
    }
    setLoading(true);
    const data = await fetchNewsTriage(saved);
    setItems(data.items);
    setOffline(data.offline);
    setWarning(data.warning || "");
    if (!data.offline) {
      await db.newsItems.bulkPut(data.items.map((item) => ({ ...item, sample: false })));
    }
    setLoading(false);
  };

  useEffect(() => {
    const saved = loadCustomAlertFeeds();
    void (async () => {
      const cached = await db.newsItems.orderBy("publishedAt").reverse().limit(48).toArray();
      if (cached.length) setItems(cached);
      setLoading(true);
      const data = await fetchNewsTriage(saved);
      setItems(data.items);
      setOffline(data.offline);
      setWarning(data.warning || "");
      if (!data.offline) await db.newsItems.bulkPut(data.items.map((item) => ({ ...item, sample: false })));
      setLoading(false);
    })();
  }, []);

  const visible = useMemo(
    () => items.filter((item) => item.status !== "dismissed" && (query === "all" || item.query === query)),
    [items, query],
  );

  const fileOnCase = async (item: NewsTriageItem, caseId: string) => {
    if (item.sample) return;
    setFilingId(item.id);
    try {
      await addEvidence({
        caseId,
        fileName: `${item.title.slice(0, 80) || "News item"}.txt`,
        fileType: "web_article",
        sourceType: "web_article",
        sourceUrl: item.link,
        publishedDate: item.publishedAt,
        rawText: `${item.title}\n\n${item.snippet}\n\n${item.link}`,
        fullText: `${item.title}\n\n${item.snippet}\n\n${item.link}`,
        fromEditorial: true,
      });
      const next = { ...item, status: "linked" as const, linkedCaseId: caseId };
      await db.newsItems.put(next);
      setItems((rows) => rows.map((row) => row.id === item.id ? next : row));
    } finally {
      setFilingId("");
    }
  };

  const dismiss = async (item: NewsTriageItem) => {
    const next = { ...item, status: "dismissed" as const };
    if (!item.sample) await db.newsItems.put(next);
    setItems((rows) => rows.map((row) => row.id === item.id ? next : row));
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 sm:px-6 sm:pt-13 lg:px-10">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        Hub
      </button>
      <div className={`mb-5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>HUB / NEWS TRIAGE</div>
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold leading-tight tracking-tight sm:text-[40px]">
          <Newspaper className="h-7 w-7 text-slate-700" />
          Louisiana news triage
        </h1>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh feeds
        </button>
      </div>
      <p className="mb-6 max-w-4xl text-[15px] leading-relaxed text-slate-500">
        Google News RSS for the Louisiana alert queries, plus any Google Alert feed URL you paste. Headlines, dates, sources, and snippets stay on this machine so they can be filed against an open case.
      </p>
      {offline && (
        <div className="mb-4 inline-flex rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-700">
          Offline / Cached samples
        </div>
      )}
      {warning && <p className="mb-4 text-[13px] text-amber-800">{warning}</p>}

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={query === "all"} label="All queries" onClick={() => setQuery("all")} />
          {LOUISIANA_ALERT_QUERIES.map((name) => (
            <FilterChip key={name} active={query === name} label={name} onClick={() => setQuery(name)} />
          ))}
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Custom Google Alert RSS</label>
          <textarea
            value={feeds}
            onChange={(e) => setFeeds(e.target.value)}
            placeholder="https://www.google.com/alerts/feeds/…"
            className="h-20 w-full resize-none rounded-[10px] border border-slate-300 px-3 py-2 text-[12.5px] outline-none focus:border-blue-600"
          />
          {feedError && <p className="mt-1 text-[12px] text-rose-700">{feedError}</p>}
        </div>
      </div>

      <ul className="space-y-3">
        {visible.map((item) => {
          const matches = matchNewsToCases(item, cases);
          return (
            <li key={item.id} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`${mono} text-[10px] tracking-[0.08em] text-slate-500`}>{item.query.toUpperCase()}</span>
                <span className="text-[12px] text-slate-400">{item.source}</span>
                <span className="text-[12px] text-slate-400">{relativeTime(item.publishedAt)}</span>
                {item.sample && <span className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">SAMPLE</span>}
                {item.status === "linked" && <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">FILED</span>}
              </div>
              <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 text-[16px] font-semibold leading-snug text-slate-900 hover:text-blue-700">
                {item.title}
                <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0" />
              </a>
              {item.snippet && <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">{item.snippet}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {matches.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onOpenCase(row.id)}
                    className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-950"
                  >
                    Possible hit · {row.subjectName || row.title}
                  </button>
                ))}
                {!item.sample && (
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-500">
                    File on case
                    <select
                      defaultValue=""
                      disabled={filingId === item.id}
                      onChange={(e) => {
                        const caseId = e.target.value;
                        e.target.value = "";
                        if (caseId) void fileOnCase(item, caseId);
                      }}
                      className="h-8 rounded-[8px] border border-slate-300 bg-white px-2 text-[12px]"
                    >
                      <option value="">Select…</option>
                      {cases.map((row) => (
                        <option key={row.id} value={row.id}>{row.doeNetworkId || row.fileIdentifier || row.id} · {row.subjectName || row.title}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" onClick={() => void dismiss(item)} className="text-[12px] font-medium text-slate-500 hover:text-slate-800">
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && !loading && (
        <div className="rounded-[14px] border border-dashed border-slate-300 px-5 py-10 text-center text-[13px] text-slate-500">
          No items in this query. Refresh the feeds to pull the next pass.
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12px] font-medium ${active ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600"}`}
    >
      {label}
    </button>
  );
}
