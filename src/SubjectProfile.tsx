import { useRef, useState } from "react";
import { Camera, Link2, Loader2, MapPin, Upload, X } from "lucide-react";
import { setCaseLocated, updateCase, type CaseRecord, type CaseStatus } from "./db";
import { encodeProfilePhoto, resolveProfilePhotoLookup } from "./lib/imageEvidence";
import {
  ALERT_LEVELS,
  alertToneClass,
  formatAlertLabel,
  formatTimeMissing,
  isUrgentAlert,
  parseLksTimestamp,
  subjectDisplayName,
  subjectPhotoSrc,
} from "./lib/missingPerson";
import { entityInitials } from "./utils/roleBadge";

const mono = "font-mono";

const STATUS_OPTIONS: { value: CaseStatus; label: string }[] = ALERT_LEVELS.map((value) => ({
  value,
  label: formatAlertLabel(value),
}));

export default function SubjectProfile({
  activeCase,
  clock,
}: {
  activeCase: CaseRecord;
  clock: number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [lookup, setLookup] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const profile = activeCase.subjectProfile ?? {};
  const subject = subjectDisplayName(activeCase);
  const lksMs = parseLksTimestamp(activeCase);
  const photo = subjectPhotoSrc(profile);
  const urgent = isUrgentAlert(activeCase.status);

  const persistPhoto = async (src: string) => {
    await updateCase(activeCase.id, {
      subjectProfile: { ...profile, photoUrl: src, photoDataUrl: src },
    });
  };

  const onLocalFile = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      await persistPhoto(await encodeProfilePhoto(file));
      setPhotoOpen(false);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not store that image.");
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onLookup = async () => {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      await persistPhoto(await resolveProfilePhotoLookup(lookup));
      setLookup("");
      setPhotoOpen(false);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not use that lookup.");
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <section className={`mb-8 grid gap-5 rounded-[16px] border bg-white p-5 shadow-sm lg:grid-cols-[auto_minmax(0,1fr)_auto] ${urgent ? "border-amber-400" : "border-slate-200"}`}>
      <div className="flex flex-col items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(e) => void onLocalFile(e.target.files?.[0])}
        />
        <div className="group relative">
          <div className={`flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl text-[22px] font-bold ${urgent ? "border border-amber-400 bg-amber-50 text-amber-950" : "border border-slate-300 bg-slate-50 text-slate-800"}`}>
            {photo ? (
              <img src={photo} alt={`${subject} profile`} className="h-full w-full object-cover" />
            ) : (
              entityInitials(subject)
            )}
          </div>
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end rounded-2xl bg-slate-950/0 opacity-0 transition group-hover:pointer-events-auto group-hover:bg-slate-950/55 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:bg-slate-950/55 group-focus-within:opacity-100">
            <div className="flex gap-1 p-1.5">
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/95 px-1 py-1.5 text-[9px] font-semibold tracking-wide text-slate-800"
                title="Upload local image"
              >
                <Upload className="h-3 w-3" />File
              </button>
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => { setPhotoError(null); setPhotoOpen(true); }}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/95 px-1 py-1.5 text-[9px] font-semibold tracking-wide text-slate-800"
                title="Add photo from URL / web lookup"
              >
                <Link2 className="h-3 w-3" />URL
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setPhotoError(null); setPhotoOpen(true); }}
          className="inline-flex items-center gap-1 text-center text-[11px] font-medium text-blue-700 hover:underline"
        >
          <Camera className="h-3 w-3" />
          Add Photo from URL / Web Lookup
        </button>
      </div>
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">{subject}</h1>
        <p className="mt-1 text-[13px] text-slate-600">
          Age at disappearance {profile.ageAtDisappearance || "—"}
          {profile.currentEstimatedAge ? ` · Current estimate ${profile.currentEstimatedAge}` : ""}
        </p>
        <div className="mt-3 grid gap-2 text-[13px] text-slate-700 sm:grid-cols-2">
          <div><span className="text-slate-500">Height / weight</span> · {[profile.height, profile.weight].filter(Boolean).join(" / ") || "—"}</div>
          <div><span className="text-slate-500">Hair / eyes</span> · {[profile.hair, profile.eyes].filter(Boolean).join(" / ") || "—"}</div>
          <div className="sm:col-span-2"><span className="text-slate-500">Marks</span> · {profile.distinguishingMarks || "None recorded"}</div>
          <div className="sm:col-span-2"><span className="text-slate-500">Clothing last seen</span> · {profile.clothingLastSeen || "—"}</div>
          {profile.medicalAlerts ? (
            <div className={`sm:col-span-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium ${alertToneClass("CRITICAL_MEDICAL")}`}>
              Vital / medical: {profile.medicalAlerts}
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{activeCase.lksLocation?.trim() || activeCase.jurisdiction?.trim() || "LKS location unassigned"}</span>
        </div>
        <div className="mt-2.5">
          {activeCase.isArchived ? (
            <span className={`inline-flex rounded-lg border px-2.5 py-1 ${mono} text-[10.5px] tracking-[0.06em] ${alertToneClass("ARCHIVED")}`}>ARCHIVED</span>
          ) : (
            <label className="block max-w-xs">
              <span className={`mb-1 block ${mono} text-[10px] tracking-[0.12em] text-slate-500`}>ALERT STATUS</span>
              <select
                value={STATUS_OPTIONS.some((o) => o.value === activeCase.status) ? activeCase.status : "ACTIVE_MISSING"}
                onChange={(e) => {
                  const status = e.target.value as CaseStatus;
                  if (status === "LOCATED") void setCaseLocated(activeCase.id);
                  else void updateCase(activeCase.id, { status, locatedAt: "" });
                }}
                className={`w-full rounded-lg border px-2.5 py-1.5 ${mono} text-[10.5px] tracking-[0.06em] outline-none ${alertToneClass(activeCase.status)}`}
                aria-label="Alert status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className={`flex min-w-[11rem] flex-col justify-center rounded-[14px] border px-4 py-4 text-center ${urgent ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-slate-50"}`}>
        <div className={`${mono} text-[10px] tracking-[0.14em] text-slate-700`}>TIME MISSING</div>
        <div className="mt-2 text-[15px] font-semibold leading-snug text-slate-950">{formatTimeMissing(lksMs, clock)}</div>
        <div className="mt-1 text-[12px] text-slate-600">{lksMs ? new Date(lksMs).toLocaleString() : "Set LKS on case create"}</div>
      </div>

      {photoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="photo-lookup-title">
          <div className="w-full max-w-md rounded-[16px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="photo-lookup-title" className="text-[16px] font-semibold text-slate-900">Add Photo from URL / Web Lookup</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">
                  Paste a flyer image URL, or a public NamUs / agency photo link. JPG, PNG, and WEBP are stored on this case in IndexedDB.
                </p>
              </div>
              <button type="button" onClick={() => setPhotoOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="https://…/flyer.jpg or image URL"
              className="w-full rounded-[10px] border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-blue-600 focus:ring-[3px] focus:ring-blue-600/12"
            />
            {photoError ? <p className="mt-2 text-[12.5px] text-rose-700">{photoError}</p> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-slate-300 px-3 text-[12.5px] font-medium text-slate-700">
                <Upload className="h-3.5 w-3.5" />Upload file instead
              </button>
              <button
                type="button"
                disabled={photoBusy || !lookup.trim()}
                onClick={() => void onLookup()}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-blue-600 px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
              >
                {photoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Use photo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
