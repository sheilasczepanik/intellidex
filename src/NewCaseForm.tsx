import { useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import type { CaseStatus, SubjectProfile } from "./db/schema";
import { ALERT_LEVELS, formatAlertLabel } from "./lib/missingPerson";
import { doeNetworkHint, parseDoeNetworkId } from "./lib/doeNetworkId";
import { doeIdFromText, lksFromDoeDate } from "./lib/doeNetworkPaste";
import { lookupOfficialId, type IdCaseDraft, type IdPrefill } from "./lib/idLookup";
import AssistedDoeDrawer, { type DoeAssistResult } from "./AssistedDoeDrawer";
import IdLookupField from "./IdLookupField";

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
  onOpenCase,
  onLoadFixture,
  onCreateFromId,
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
  onOpenCase: (caseId: string) => void;
  onLoadFixture: (draft: IdCaseDraft) => void;
  onCreateFromId: (prefill: IdPrefill) => void;
}) {
  const setP = (key: keyof SubjectProfile, value: string) => onProfile({ ...profile, [key]: value });
  const [doeOpen, setDoeOpen] = useState(false);
  const [doeUrl, setDoeUrl] = useState("");
  const [doeBusy, setDoeBusy] = useState(false);
  const [doeNotice, setDoeNotice] = useState("");
  const [doeErr, setDoeErr] = useState("");
  const doeHint = doeNetworkHint(doeNetworkId);
  const doeInvalid = Boolean(doeNetworkId.trim() && doeHint.startsWith("Use "));

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:px-10">
      <div className={`mb-2.5 ${mono} text-[11px] tracking-[0.14em] text-slate-500`}>NEW SEARCH / LOCAL VAULT</div>
      <h1 className="mb-2 text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">Open a missing person workspace</h1>
      <p className="mb-8 max-w-[54ch] text-[14px] leading-relaxed text-slate-500">
        Capture the subject, last known sighting, and alert level. Tips, search logs, and extraction land on Overview after you create the case.
      </p>
      <div className="mb-6 rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-sm">
        <IdLookupField doeOnly onOpenCase={onOpenCase} onLoadFixture={onLoadFixture} onCreateFromId={onCreateFromId} />
      </div>
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
        <input
          value={fileIdentifier}
          onChange={(e) => onFileIdentifier(e.target.value)}
          placeholder="Local or agency file number"
          className={`${inputCls} mb-4 h-11 text-[14px]`}
        />
        <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Doe Network ID</label>
        <div className="mb-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={doeNetworkId}
            onChange={(e) => {
              const value = e.target.value;
              const fromUrl = doeIdFromText(value);
              if (/^https?:\/\//i.test(value) && fromUrl) setDoeUrl(value);
              onDoeNetworkId(fromUrl || value.toUpperCase());
              setDoeErr("");
              setDoeNotice("");
            }}
            placeholder="93DMFL or 1187UMFL"
            className={`${inputCls} h-11 flex-1 text-[14px] ${mono}`}
          />
          <button
            type="button"
            onClick={() => void autoFillDoe()}
            disabled={doeBusy}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-300 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            {doeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-blue-600" />}
            {doeBusy ? "Checking local records…" : "Auto-Fill from Doe Network"}
          </button>
        </div>
        {doeNetworkId.trim() && !doeInvalid ? (
          <p className="mt-1.5 text-[12px] text-slate-500">{doeHint}</p>
        ) : null}
        {doeNotice ? (
          <p className="mb-4 mt-1.5 text-[12.5px] text-amber-800">{doeNotice}</p>
        ) : doeErr || doeInvalid ? (
          <p className="mb-4 mt-1.5 text-[12.5px] text-rose-700">{doeErr || doeHint}</p>
        ) : (
          <p className="mb-4 mt-1.5 text-[12px] text-slate-400">Use a Doe Network ID such as 93DMFL, or paste a profile when the page will not load.</p>
        )}
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
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Sex</label>
            <input value={profile.sex ?? ""} onChange={(e) => setP("sex", e.target.value)} placeholder="Female" className={`${inputCls} h-11 text-[14px]`} />
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
      <AssistedDoeDrawer
        open={doeOpen}
        initialUrl={doeUrl}
        onClose={() => setDoeOpen(false)}
        onApply={(result) => {
          applyDoe(result);
          setDoeOpen(false);
        }}
      />
    </div>
  );

  async function autoFillDoe() {
    const raw = doeNetworkId.trim() || fileIdentifier.trim();
    const fromUrl = doeIdFromText(raw);
    const parsed = parseDoeNetworkId(fromUrl || raw);
    setDoeErr("");
    setDoeNotice("");
    if (raw && !parsed) {
      setDoeErr("Use a Doe Network ID such as 93DMFL or 1187UMFL.");
      return;
    }
    if (parsed) onDoeNetworkId(parsed.id);
    if (!parsed) {
      setDoeUrl("");
      setDoeOpen(true);
      setDoeNotice("Paste the Doe Network URL and the copied profile.");
      return;
    }
    setDoeBusy(true);
    try {
      const hit = await lookupOfficialId(parsed.id);
      if (hit?.state === "case") {
        onOpenCase(hit.caseId);
        return;
      }
      if (hit?.state === "fixture") {
        onLoadFixture(hit.draft);
        setDoeNotice("Loaded from the local Doe Network fixture.");
        return;
      }
      const url = /^https?:\/\//i.test(doeUrl) ? doeUrl : `https://www.doenetwork.org/cases/${parsed.state.toLowerCase()}/${parsed.id.toLowerCase()}.html`;
      setDoeUrl(url);
      setDoeOpen(true);
      setDoeNotice(`Paste the copied Doe Network profile for ${parsed.id}.`);
    } finally {
      setDoeBusy(false);
    }
  }

  function applyDoe(result: DoeAssistResult) {
    const data = result.record;
    const doeId = data.doeNetworkId || doeIdFromText(result.url);
    if ((!title.trim() || /^https?:\/\//i.test(title.trim())) && data.fullName) onTitle(data.fullName);
    if (doeId) onDoeNetworkId(doeId);
    if (data.location) onJurisdiction(data.location);
    const lks = lksFromDoeDate(data.dateLastSeen);
    if (lks) onLksAt(lks);
    if (data.circumstances || data.caseNotes) onSummary(data.circumstances || data.caseNotes);
    onProfile({
      ...profile,
      sex: data.sex || profile.sex || "",
      ageAtDisappearance: data.ageAtDisappearance || profile.ageAtDisappearance || "",
      currentEstimatedAge: data.currentAge || profile.currentEstimatedAge || "",
      dateOfBirth: data.dateOfBirth || profile.dateOfBirth || "",
      height: data.height || profile.height || "",
      weight: data.weight || profile.weight || "",
      hair: data.hair || profile.hair || "",
      eyes: data.eyes || profile.eyes || "",
      distinguishingMarks: data.distinguishingMarks || profile.distinguishingMarks || "",
      clothingLastSeen: data.clothing || profile.clothingLastSeen || "",
      medicalAlerts: data.medicalAlerts || profile.medicalAlerts || "",
    });
    setDoeErr("");
    setDoeNotice(result.engine === "gpt-4o" ? "Structured with GPT-4o." : "Structured from the pasted text on this machine.");
  }
}
