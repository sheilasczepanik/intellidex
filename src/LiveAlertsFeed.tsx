import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, FolderPlus, RefreshCw } from "lucide-react";
import { fetchMissingAlerts } from "./lib/alertsClient";
import { FALLBACK_MISSING_ALERTS, type LiveMissingAlert } from "./lib/liveMissingAlert";

const POLL_MS = 5 * 60 * 1000;
const mono = "font-mono";

function relativeTime(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const delta = Date.now() - ms;
  const min = Math.round(delta / 60000);
  if (Math.abs(min) < 1) return "just now";
  if (Math.abs(min) < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (Math.abs(hrs) < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function typeChip(alertType: LiveMissingAlert["alertType"]) {
  if (alertType === "AMBER Alert") return "border-red-300 bg-red-50 text-red-950";
  if (alertType === "Endangered Missing") return "border-amber-300 bg-amber-50 text-amber-950";
  if (alertType === "Silver Alert") return "border-sky-300 bg-sky-50 text-sky-950";
  return "border-slate-300 bg-slate-50 text-slate-800";
}

export default function LiveAlertsFeed({
  creatorLabel,
  onBack,
  onOpenAsCase,
}: {
  creatorLabel: string;
  onBack: () => void;
  onOpenAsCase: (alert: LiveMissingAlert) => void;
}) {
  const [alerts, setAlerts] = useState<LiveMissingAlert[]>([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [warning, setWarning] = useState("");
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const data = await fetchMissingAlerts({ refresh });
      setAlerts(data.alerts);
      setFetchedAt(data.fetchedAt);
      setOffline(Boolean(data.offline));
      setWarning(data.offline ? "" : (data.warning || ""));
    } catch (err) {
      console.error("[alerts] UI load failed", err);
      setAlerts(FALLBACK_MISSING_ALERTS);
      setOffline(true);
      setWarning("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const id = window.setInterval(() => void load(false), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-8 sm:px-6 sm:pt-13 lg:px-10">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Hub
      </button>
      <div className={`mb-5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>
        HUB / LIVE ALERTS // {creatorLabel}
      </div>
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex items-center gap-3 text-[28px] font-semibold leading-tight tracking-tight sm:text-[40px]">
          <span className="relative mt-2 flex h-2.5 w-2.5 shrink-0">
            <span className={`absolute inline-flex h-full w-full rounded-full ${offline ? "bg-slate-400" : "animate-ping bg-red-400 opacity-60"}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${offline ? "bg-slate-500" : "bg-red-500"}`} />
          </span>
          Live missing alerts
        </h1>
        <div className="flex flex-wrap items-center gap-2 sm:mt-2">
          {offline && (
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-700">
              Offline / Cached Feed
            </span>
          )}
          {fetchedAt && (
            <span className={`${mono} text-[10.5px] text-slate-400`}>
              {loading ? "Updating…" : `Updated ${relativeTime(fetchedAt)}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>
      <p className="mb-8 w-full max-w-4xl text-[15px] leading-relaxed text-slate-500">
        Public NCMEC missing-person RSS (not a substitute for agency AMBER channels). Open a poster on missingkids.org, or start a local workspace from an item.
      </p>

      {warning && !offline && (
        <div className="mb-4 rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-[12.5px] text-slate-700">
          {warning}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading && !alerts.length ? (
          <div className="px-4 py-10 text-center text-[13px] text-slate-500 sm:px-5">Checking public alert feeds…</div>
        ) : !alerts.length ? (
          <div className="px-4 py-10 text-center text-[13px] text-slate-500 sm:px-5">No live items from the public feeds right now.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex gap-3 px-4 py-3.5 sm:px-5">
                {alert.photoUrl ? (
                  <img
                    src={alert.photoUrl}
                    alt=""
                    className="h-16 w-14 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-medium text-slate-400 ring-1 ring-slate-200">
                    No photo
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-slate-900">{alert.name}</span>
                    {alert.age && <span className="text-[12px] text-slate-500">Age {alert.age}</span>}
                    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${typeChip(alert.alertType)}`}>
                      {alert.alertType}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {alert.location}
                    <span className="mx-1.5 text-slate-300">·</span>
                    {relativeTime(alert.timestamp)}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-slate-600">{alert.summary}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={alert.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 px-2.5 text-[11.5px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open poster
                    </a>
                    <button
                      type="button"
                      onClick={() => onOpenAsCase(alert)}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-blue-600 px-2.5 text-[11.5px] font-semibold text-white hover:bg-blue-700"
                    >
                      <FolderPlus className="h-3 w-3" />
                      Open as case
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
