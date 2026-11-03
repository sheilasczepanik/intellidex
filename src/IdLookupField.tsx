import { useEffect, useState } from "react";
import { FolderPlus, Search } from "lucide-react";
import {
  lookupOfficialId,
  parseOfficialId,
  type IdCaseDraft,
  type IdLookupResult,
  type IdPrefill,
  type IdProfile,
} from "./lib/idLookup";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

type Props = {
  doeOnly?: boolean;
  onOpenCase: (caseId: string) => void;
  onLoadFixture: (draft: IdCaseDraft) => void;
  onCreateFromId: (prefill: IdPrefill) => void;
};

function formatWhen(value: string) {
  if (!value) return "Date not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function IdLookupCard({
  result,
  doeOnly = false,
  onOpenCase,
  onLoadFixture,
  onCreateFromId,
}: Props & { result: IdLookupResult }) {
  if (result.state === "invalid") {
    return (
      <p className="text-[12.5px] text-slate-500">
        {doeOnly
          ? "Use a Doe Network ID such as 93DMFL or 1187UMFL."
          : "Use a Doe Network ID such as 93DMFL, or a NamUs number such as MP2316 or UP1028."}
      </p>
    );
  }
  if (result.state === "missing") {
    return (
      <div className="rounded-[12px] border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
        <p className="text-[13px] font-medium text-slate-800">{result.prefill.officialId} is not in the local case file or fixture set.</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
          Create a case with {result.prefill.officialId} already entered. No page is fetched.
        </p>
        <button
          type="button"
          onClick={() => onCreateFromId(result.prefill)}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 text-[12.5px] font-semibold text-white hover:bg-blue-700"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Create New Case from ID
        </button>
      </div>
    );
  }
  return (
    <ProfileCard
      profile={result.profile}
      action={result.state === "case" ? "Open workspace" : "Open in case file"}
      onAction={() => {
        if (result.state === "case") onOpenCase(result.caseId);
        if (result.state === "fixture") onLoadFixture(result.draft);
      }}
    />
  );
}

function ProfileCard({ profile, action, onAction }: { profile: IdProfile; action: string; onAction: () => void }) {
  const descriptors = [profile.sex, profile.age && `Age ${profile.age}`, profile.height, profile.weight, profile.hair && `${profile.hair} hair`, profile.eyes && `${profile.eyes} eyes`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`${mono} text-[10.5px] tracking-[0.08em] text-slate-500`}>
            {profile.officialId} · {profile.source === "case" ? "LOCAL CASE" : "LOCAL FIXTURE"}
          </div>
          <div className="mt-1 text-[16px] font-semibold tracking-tight text-slate-900">{profile.name}</div>
        </div>
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">{profile.statusLabel}</span>
      </div>
      <p className="mt-2 text-[12.5px] text-slate-600">{formatWhen(profile.date)}{profile.location ? ` · ${profile.location}` : ""}</p>
      {descriptors && <p className="mt-1 text-[12.5px] text-slate-600">{descriptors}</p>}
      {profile.circumstances && <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-slate-500">{profile.circumstances}</p>}
      {profile.links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {profile.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className={`${mono} text-[11px] text-blue-700 underline-offset-2 hover:underline`}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex h-9 items-center rounded-[10px] bg-slate-900 px-3 text-[12.5px] font-semibold text-white hover:bg-slate-800"
      >
        {action}
      </button>
    </div>
  );
}

export default function IdLookupField({ doeOnly = false, ...props }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<IdLookupResult | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResult(null);
      return;
    }
    let cancel = false;
    const handle = window.setTimeout(() => {
      void lookupOfficialId(q).then((hit) => {
        if (cancel) return;
        if (doeOnly && parseOfficialId(q)?.kind === "namus") {
          setResult({ state: "invalid" });
          return;
        }
        setResult(hit);
      });
    }, 60);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [doeOnly, query]);

  const apply = () => {
    if (!result || result.state === "invalid") return;
    if (result.state === "case") props.onOpenCase(result.caseId);
    if (result.state === "fixture") props.onLoadFixture(result.draft);
    if (result.state === "missing") props.onCreateFromId(result.prefill);
  };

  return (
    <div>
      <label htmlFor="official-id-lookup" className="mb-1.5 block text-[12px] font-semibold text-slate-700">
        {doeOnly ? "Look up a Doe Network ID" : "Doe Network or NamUs ID"}
      </label>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            id="official-id-lookup"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              apply();
            }}
            placeholder={doeOnly ? "93DMFL or 1187UMFL" : "93DMFL, MP2316, or UP1028"}
            autoCapitalize="characters"
            className={`${inputCls} h-11 pl-9 text-[14px] ${mono}`}
          />
        </div>
      </div>
      <p className="mb-3 mt-1.5 text-[12px] text-slate-500">
        {doeOnly
          ? "Checks case files and local fixtures on this machine. The Doe Network page is not fetched."
          : "Checks case files and local fixtures on this machine. The NamUs and Doe Network pages are not fetched."}
      </p>
      {result && <IdLookupCard doeOnly={doeOnly} result={result} {...props} />}
    </div>
  );
}
