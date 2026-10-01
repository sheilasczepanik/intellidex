import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { setCaseLocated, updateCase, type CaseRecord, type CaseStatus } from "./db";
import type { SubjectProfile } from "./db/schema";
import { ALERT_LEVELS, formatAlertLabel } from "./lib/missingPerson";

const mono = "font-mono";
const inputCls =
  "w-full rounded-[10px] border border-slate-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12";

export type ProfileFocusField =
  | "name"
  | "ageAtDisappearance"
  | "dateOfBirth"
  | "height"
  | "weight"
  | "hair"
  | "eyes"
  | "distinguishingMarks"
  | "clothingLastSeen"
  | "lksAt"
  | "lksLocation"
  | "status";

function toDatetimeLocal(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return s.slice(0, 16);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditSubjectProfileDrawer({
  activeCase,
  focusField,
  onClose,
}: {
  activeCase: CaseRecord;
  focusField?: ProfileFocusField;
  onClose: () => void;
}) {
  const profile = activeCase.subjectProfile ?? {};
  const [name, setName] = useState(activeCase.subjectName?.trim() || activeCase.title || "");
  const [ageAtDisappearance, setAgeAtDisappearance] = useState(profile.ageAtDisappearance ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(profile.dateOfBirth ?? "");
  const [height, setHeight] = useState(profile.height ?? "");
  const [weight, setWeight] = useState(profile.weight ?? "");
  const [hair, setHair] = useState(profile.hair ?? "");
  const [eyes, setEyes] = useState(profile.eyes ?? "");
  const [distinguishingMarks, setDistinguishingMarks] = useState(profile.distinguishingMarks ?? "");
  const [clothingLastSeen, setClothingLastSeen] = useState(profile.clothingLastSeen ?? "");
  const [lksAt, setLksAt] = useState(toDatetimeLocal(activeCase.lksAt || activeCase.incidentStart || ""));
  const [lksLocation, setLksLocation] = useState(activeCase.lksLocation || activeCase.jurisdiction || "");
  const [status, setStatus] = useState<CaseStatus>(
    ALERT_LEVELS.includes(activeCase.status as (typeof ALERT_LEVELS)[number]) ? activeCase.status : "ACTIVE_MISSING",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => firstRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [focusField]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bind = (field: ProfileFocusField) => ({
    ref: (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => {
      if (field === (focusField || "name")) firstRef.current = el;
    },
  });

  const onSave = async () => {
    const nextName = name.trim();
    if (!nextName) {
      setError("Full legal name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const nextProfile: SubjectProfile = {
        ...profile,
        ageAtDisappearance: ageAtDisappearance.trim(),
        dateOfBirth: dateOfBirth.trim(),
        height: height.trim(),
        weight: weight.trim(),
        hair: hair.trim(),
        eyes: eyes.trim(),
        distinguishingMarks: distinguishingMarks.trim(),
        clothingLastSeen: clothingLastSeen.trim(),
      };
      const nextLks = lksAt.trim();
      if (status === "LOCATED") {
        await setCaseLocated(activeCase.id);
        await updateCase(activeCase.id, {
          title: nextName,
          subjectName: nextName,
          lksAt: nextLks,
          lksLocation: lksLocation.trim(),
          jurisdiction: lksLocation.trim() || activeCase.jurisdiction,
          incidentStart: nextLks ? nextLks.slice(0, 10) : activeCase.incidentStart,
          subjectProfile: nextProfile,
        });
      } else {
        await updateCase(activeCase.id, {
          title: nextName,
          subjectName: nextName,
          lksAt: nextLks,
          lksLocation: lksLocation.trim(),
          jurisdiction: lksLocation.trim() || activeCase.jurisdiction,
          incidentStart: nextLks ? nextLks.slice(0, 10) : activeCase.incidentStart,
          subjectProfile: nextProfile,
          status,
          locatedAt: "",
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="edit-subject-title">
      <button type="button" className="flex-1 cursor-default" aria-label="Close edit profile" onClick={onClose} />
      <div className="flex h-full w-[460px] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-6 pb-[18px] pt-[22px]">
          <div>
            <div className={`mb-1 ${mono} text-[10.5px] tracking-[0.14em] text-slate-500`}>CASE FILE</div>
            <h2 id="edit-subject-title" className="text-[17px] font-bold tracking-tight">Edit Subject Profile &amp; LKS</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
              Baseline identity and last known sighting. Saving updates TIME MISSING on the hero card immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-auto px-6 py-5">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Full legal name</label>
            <input {...bind("name")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Maura Murray" className={`${inputCls} h-11 text-[15px] font-semibold`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Age at disappearance</label>
              <input {...bind("ageAtDisappearance")} value={ageAtDisappearance} onChange={(e) => setAgeAtDisappearance(e.target.value)} placeholder="21" className={`${inputCls} h-11 text-[14px]`} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Date of birth</label>
              <input {...bind("dateOfBirth")} type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={`${inputCls} h-11 text-[14px]`} />
            </div>
          </div>
          <div className={`mt-1 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>PHYSICAL DEMOGRAPHICS</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Height</label>
              <input {...bind("height")} value={height} onChange={(e) => setHeight(e.target.value)} placeholder={'5\'7"'} className={`${inputCls} h-11 text-[14px]`} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Weight</label>
              <input {...bind("weight")} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="120 lbs" className={`${inputCls} h-11 text-[14px]`} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Hair color</label>
              <input {...bind("hair")} value={hair} onChange={(e) => setHair(e.target.value)} placeholder="Light Brown" className={`${inputCls} h-11 text-[14px]`} />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Eye color</label>
              <input {...bind("eyes")} value={eyes} onChange={(e) => setEyes(e.target.value)} placeholder="Green / Hazel" className={`${inputCls} h-11 text-[14px]`} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Distinguishing marks &amp; features</label>
            <textarea
              {...bind("distinguishingMarks")}
              value={distinguishingMarks}
              onChange={(e) => setDistinguishingMarks(e.target.value)}
              placeholder="Dimple on right cheek, small scar above right eyebrow"
              className={`${inputCls} h-[88px] resize-none py-2.5 text-[13.5px] leading-relaxed`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Clothing &amp; belongings last seen</label>
            <textarea
              {...bind("clothingLastSeen")}
              value={clothingLastSeen}
              onChange={(e) => setClothingLastSeen(e.target.value)}
              placeholder="Dark jacket, jeans, black backpack"
              className={`${inputCls} h-[88px] resize-none py-2.5 text-[13.5px] leading-relaxed`}
            />
          </div>
          <div className={`mt-1 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>LAST KNOWN SIGHTING</div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">LKS date &amp; time</label>
            <input {...bind("lksAt")} type="datetime-local" value={lksAt} onChange={(e) => setLksAt(e.target.value)} className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">LKS location / address</label>
            <input {...bind("lksLocation")} value={lksLocation} onChange={(e) => setLksLocation(e.target.value)} placeholder="Route 112, Haverhill, NH" className={`${inputCls} h-11 text-[14px]`} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-slate-700">Alert status</label>
            <select {...bind("status")} value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)} className={`${inputCls} h-11 text-[14px]`}>
              {ALERT_LEVELS.map((level) => (
                <option key={level} value={level}>{formatAlertLabel(level)}</option>
              ))}
            </select>
          </div>
          {error ? <p className="text-[12.5px] text-rose-700">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => void onSave()}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-blue-600 px-4 text-[13.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
