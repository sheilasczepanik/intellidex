import { useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import type { CaseStatus, SubjectProfile } from "./db/schema";
import { fetchNamusRecord } from "./lib/namusClient";
import { extractNamusId, namusNumericId } from "./lib/namusRecord";
import { ALERT_LEVELS, formatAlertLabel } from "./lib/missingPerson";
import { doeNetworkHint } from "./lib/doeNetworkId";
import { lksFromNamusDate } from "./lib/namusPaste";
import AssistedNamusDrawer, { type NamusAssistResult } from "./AssistedNamusDrawer";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

export default function NewCaseForm({
  title,
  fileIdentifier,
  doeNetworkId,
  jurisdiction,
  lksAt,
  alertLevel,
  summary,
  profile,
  saving,
  onTitle,
  onFileIdentifier,
  onDoeNetworkId,
  onJurisdiction,
  onLksAt,
  onAlertLevel,
  onSummary,
  onProfile,
  onCancel,
  onSubmit,
}: {
  title: string;
  fileIdentifier: string;
  doeNetworkId: string;
  jurisdiction: string;
  lksAt: string;
  alertLevel: CaseStatus;
  summary: string;
  profile: SubjectProfile;
  saving: boolean;
  onTitle: (value: string) => void;
  onFileIdentifier: (value: string) => void;
  onDoeNetworkId: (value: string) => void;
  onJurisdiction: (value: string) => void;
  onLksAt: (value: string) => void;
  onAlertLevel: (value: CaseStatus) => void;
  onSummary: (value: string) => void;
  onProfile: (next: SubjectProfile) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const setP = (key: keyof SubjectProfile, value: string) => onProfile({ ...profile, [key]: value });
  const [namusBusy, setNamusBusy] = useState(false);
  const [namusOk, setNamusOk] = useState(false);
  const [namusErr, setNamusErr] = useState("");
  const [namusNotice, setNamusNotice] = useState("");
  const [assistOpen, setAssistOpen] = useState(false);
  const doeHint = doeNetworkHint(doeNetworkId);

  const autoFillNamus = async () => {
    const query = fileIdentifier.trim() || title.trim();
    const cleanNamusId = query.trim().toUpperCase();
    if (!namusNumericId(cleanNamusId) && !extractNamusId(cleanNamusId)) {
      setNamusOk(false);
      setNamusNotice("");
      setNamusErr("Enter a NamUs ID such as MP2316 in the case identifier field.");
      return;
    }
    setNamusBusy(true);
    setNamusOk(false);
    setNamusErr("");
    setNamusNotice("");
    try {
      const response = await fetchNamusRecord(cleanNamusId);
      const data = response.data;
      if (!data?.name) {
        setNamusErr("Enter a NamUs ID such as MP2316 in the case identifier field.");
        return;
      }
      onTitle(data.name);
      onFileIdentifier((data.caseId ? String(data.caseId) : cleanNamusId).trim().toUpperCase());
      onJurisdiction(data.location || "");
      if (data.lksDate) onLksAt(String(data.lksDate));
      if (data.circumstances) onSummary(String(data.circumstances));
      onProfile({
        ...profile,
        ageAtDisappearance: data.ageAtDisappearance != null && String(data.ageAtDisappearance) !== "0" ? String(data.ageAtDisappearance) : "",
        currentEstimatedAge: data.currentAge != null && String(data.currentAge) !== "0" ? String(data.currentAge) : "",
        height: data.height || "",
        weight: data.weight || "",
        hair: data.hair || "",
        eyes: data.eyes || "",
        distinguishingMarks: data.distinguishingMarks || data.marks || "",
        clothingLastSeen: data.clothing || "",
        medicalAlerts: data.medicalAlerts || "",
      });
      setNamusNotice("");
      setNamusOk(true);
    } catch {
      setNamusErr("Enter a NamUs ID such as MP2316 in the case identifier field.");
    } finally {
      setNamusBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:px-10">
      <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>NEW SEARCH / LOCAL VAULT</div>
      <h1 className="mb-2 text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">Open a missing person workspace</h1>
      <p className="mb-8 max-w-[54ch] text-[14px] leading-relaxed text-slate-500">
        Capture the subject, last known sighting, and alert level. Tips, search logs, and extraction land on Overview after you create the case.
      </p>
      <form
        className="rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Missing person full name</label>
        <input
          required
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Subject name"
          className={`${inputCls} mb-4 h-11 text-[15px] font-semibold`}
        />
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Case / file identifier</label>
        <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={fileIdentifier}
            onChange={(e) => { setNamusOk(false); setNamusErr(""); setNamusNotice(""); onFileIdentifier(e.target.value); }}
            placeholder="MP1028, NamUs #, or agency case #"
            className={`${inputCls} h-11 flex-1 text-[14px]`}
          />
          <button
            type="button"
            onClick={() => void autoFillNamus()}
            disabled={namusBusy}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-300 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            {namusBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-blue-600" />}
            {namusBusy ? "Fetching NamUs data…" : "Auto-Fill from NamUs"}
          </button>
        </div>
        {namusOk ? (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-800">
            <Check className="h-3.5 w-3.5" />
            Loaded from NamUs record
          </div>
        ) : namusNotice ? (
          <p className="mb-4 text-[12.5px] text-amber-800">{namusNotice}</p>
        ) : namusErr ? (
          <p className="mb-4 text-[12.5px] text-rose-700">{namusErr}</p>
        ) : (
          <p className="mb-4 text-[12px] text-slate-400">Use a NamUs ID such as MP2316 to pull a known public record, or paste a profile when the page will not load.</p>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAssistOpen(true)}
            className="inline-flex h-9 items-center rounded-[10px] border border-slate-300 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Assisted NamUs ingest
          </button>
          <span className="text-[12px] text-slate-400">Paste a URL and the profile text. Nothing is scraped from NamUs.</span>
        </div>
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Doe Network ID</label>
        <input
          value={doeNetworkId}
          onChange={(e) => onDoeNetworkId(e.target.value.toUpperCase())}
          placeholder="93DMFL or 1187UMFL"
          className={`${inputCls} h-11 text-[14px] ${mono}`}
        />
        <p className={`mb-4 mt-1.5 text-[12px] ${doeNetworkId.trim() && doeHint.startsWith("Use ") ? "text-rose-700" : "text-slate-500"}`}>
          {doeHint || "4 digits and 4 letters, such as 1187UMFL. Short year forms such as 93DMFL are accepted."}
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Last known sighting date & time</label>
            <input
              type="datetime-local"
              value={lksAt}
              onChange={(e) => onLksAt(e.target.value)}
              className={`${inputCls} h-11 text-[14px]`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Initial alert level</label>
            <select
              value={ALERT_LEVELS.includes(alertLevel as (typeof ALERT_LEVELS)[number]) ? alertLevel : "ACTIVE_MISSING"}
              onChange={(e) => onAlertLevel(e.target.value as CaseStatus)}
              className={`${inputCls} h-11 text-[14px]`}
            >
              {ALERT_LEVELS.map((level) => (
                <option key={level} value={level}>{formatAlertLabel(level)}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Last known location / jurisdiction</label>
        <input
          value={jurisdiction}
          onChange={(e) => onJurisdiction(e.target.value)}
          placeholder="City, state, county"
          className={`${inputCls} mb-4 h-11 text-[14px]`}
        />

        <div className={`mb-3 mt-2 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>SUBJECT PROFILE</div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Age at disappearance</label>
            <input value={profile.ageAtDisappearance ?? ""} onChange={(e) => setP("ageAtDisappearance", e.target.value)} placeholder="21" className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Current estimated age</label>
            <input value={profile.currentEstimatedAge ?? ""} onChange={(e) => setP("currentEstimatedAge", e.target.value)} placeholder="43" className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Height</label>
            <input value={profile.height ?? ""} onChange={(e) => setP("height", e.target.value)} placeholder="5'3&quot;" className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Weight</label>
            <input value={profile.weight ?? ""} onChange={(e) => setP("weight", e.target.value)} placeholder="120 lbs" className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Hair</label>
            <input value={profile.hair ?? ""} onChange={(e) => setP("hair", e.target.value)} placeholder="Brown" className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Eyes</label>
            <input value={profile.eyes ?? ""} onChange={(e) => setP("eyes", e.target.value)} placeholder="Blue" className={`${inputCls} h-11 text-[14px]`} />
          </div>
        </div>
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Distinguishing marks</label>
        <input
          value={profile.distinguishingMarks ?? ""}
          onChange={(e) => setP("distinguishingMarks", e.target.value)}
          placeholder="Scars, tattoos, dental"
          className={`${inputCls} mb-4 h-11 text-[14px]`}
        />
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Clothing & gear when last seen</label>
        <input
          value={profile.clothingLastSeen ?? ""}
          onChange={(e) => setP("clothingLastSeen", e.target.value)}
          placeholder="Dark coat, jeans, backpack"
          className={`${inputCls} mb-4 h-11 text-[14px]`}
        />
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Vital / medical alerts</label>
        <input
          value={profile.medicalAlerts ?? ""}
          onChange={(e) => setP("medicalAlerts", e.target.value)}
          placeholder="Requires daily insulin, non-verbal"
          className={`${inputCls} mb-4 h-11 text-[14px]`}
        />

        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">
          Circumstances / brief <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          value={summary}
          onChange={(e) => onSummary(e.target.value)}
          placeholder="What is known about the disappearance"
          className={`${inputCls} mb-6 h-[104px] resize-none py-2.5 text-[13.5px] leading-relaxed`}
        />
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || saving}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            Create search workspace
          </button>
        </div>
      </form>
      <AssistedNamusDrawer
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        onApply={(result) => applyAssist(result)}
      />
    </div>
  );

  function applyAssist(result: NamusAssistResult) {
    const data = result.record;
    if (!title.trim() && data.fullName) onTitle(data.fullName);
    if (!fileIdentifier.trim() && data.namusId) onFileIdentifier(`MP${data.namusId}`);
    if (!jurisdiction.trim() && data.location) onJurisdiction(data.location);
    const lks = lksFromNamusDate(data.dateLastSeen);
    if (!lksAt && lks) onLksAt(lks);
    if (!summary.trim() && (data.circumstances || data.caseNotes)) onSummary(data.circumstances || data.caseNotes);
    onProfile({
      ...profile,
      ageAtDisappearance: profile.ageAtDisappearance || data.ageAtDisappearance,
      currentEstimatedAge: profile.currentEstimatedAge || data.currentAge,
      dateOfBirth: profile.dateOfBirth || data.dateOfBirth,
      height: profile.height || data.height,
      weight: profile.weight || data.weight,
      hair: profile.hair || data.hair,
      eyes: profile.eyes || data.eyes,
      distinguishingMarks: profile.distinguishingMarks || data.distinguishingMarks,
      clothingLastSeen: profile.clothingLastSeen || data.clothing,
      medicalAlerts: profile.medicalAlerts || data.medicalAlerts,
    });
    setNamusOk(true);
    setNamusNotice(result.engine === "gpt-4o" ? "Structured with GPT-4o." : "Structured from the pasted text on this machine.");
    setNamusErr("");
  }
}
