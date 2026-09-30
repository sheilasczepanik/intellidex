import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import {
  OPERATOR_ROLES,
  computeAvatarInitials,
  hydrateUserProfile,
  namesFromCreator,
  type OperatorPermissions,
  type UserProfile,
} from "./db";

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/12";
const helperCls = "mt-1.5 text-xs text-slate-400";
const cardCls = "mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm";

const PERMISSION_ROWS: { key: keyof OperatorPermissions; label: string; hint: string }[] = [
  { key: "canDeleteEvidence", label: "Delete raw intake files", hint: "Remove source files from the local vault." },
  { key: "canExportDossier", label: "Export INTELLIDEX packs (JSON / PDF / CSV)", hint: "Package case records for offline transfer." },
  { key: "canOverrideContradictions", label: "Bypass AI timeline contradiction blocks", hint: "Confirm events even when the chronology flags a conflict." },
  { key: "canManageTeam", label: "Manage case team & external collaborators", hint: "Invite reviewers and assign workspace access." },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${on ? "bg-blue-600" : "bg-slate-300"}`}
    >
      <span
        className={`block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${on ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

export default function ProfileSettings({
  profile,
  saving,
  onSave,
  onCancel,
}: {
  profile: UserProfile;
  saving?: boolean;
  onSave: (next: UserProfile) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => hydrateUserProfile(profile));
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [initialsEl, setInitialsEl] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    const next = hydrateUserProfile(profile);
    setDraft(next);
    setInitialsTouched(false);
  }, [profile.id, profile.updatedAt]);

  const names = useMemo(() => namesFromCreator(draft.creatorName), [draft.creatorName]);
  const computed = useMemo(
    () => computeAvatarInitials(names.firstName, names.lastName),
    [names.firstName, names.lastName],
  );
  const displayInitials = (initialsTouched ? draft.avatarInitials.trim() : computed).slice(0, 3).toUpperCase() || computed;

  const patch = (partial: Partial<UserProfile>) => {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      if (!initialsTouched && "creatorName" in partial) {
        const split = namesFromCreator(next.creatorName);
        next.avatarInitials = computeAvatarInitials(split.firstName, split.lastName);
      }
      return next;
    });
  };

  return (
    <div className="mx-auto w-full max-w-[780px] px-4 pb-20 pt-8 sm:px-6 sm:pt-12 lg:px-10">
      <div className="mb-2.5 font-mono text-[11px] tracking-[0.14em] text-slate-500">SETTINGS / CREATOR PROFILE</div>

      <div className="mb-8 flex items-center gap-5">
        <div className="relative shrink-0">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xl font-bold tracking-tight text-blue-700">
            {displayInitials}
          </div>
          <button
            type="button"
            aria-label="Change initials"
            onClick={() => initialsEl?.focus()}
            className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {draft.creatorName.trim() || "Host / Lead Researcher"}
          </h1>
          <p className="mt-1 text-sm font-normal text-slate-500">
            {draft.role}{draft.showTitle.trim() ? ` · ${draft.showTitle}` : ""}
          </p>
        </div>
      </div>

      <section className={cardCls}>
        <h2 className="text-base font-semibold text-slate-900">Creator identity</h2>
        <p className="mt-0.5 text-xs text-slate-500">Shown on the Hub hero and the top-right avatar chip.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Creator name</label>
            <input
              value={draft.creatorName}
              onChange={(e) => patch({ creatorName: e.target.value })}
              placeholder="Host / Lead Researcher"
              className={inputCls}
            />
            <p className={helperCls}>Updates CREATOR // on the Hub.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Show / publication name</label>
            <input
              value={draft.showTitle}
              onChange={(e) => patch({ showTitle: e.target.value })}
              placeholder="Podcast / Publication Name"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Avatar initials</label>
            <input
              ref={setInitialsEl}
              value={draft.avatarInitials}
              maxLength={3}
              onChange={(e) => { setInitialsTouched(true); patch({ avatarInitials: e.target.value.toUpperCase() }); }}
              placeholder={computed}
              className={`${inputCls} w-24 font-mono tracking-[0.12em]`}
            />
            <p className={helperCls}>Leave blank to derive from name ({computed}).</p>
          </div>
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="text-base font-semibold text-slate-900">Role & workspace permissions</h2>
        <p className="mt-0.5 text-xs text-slate-500">Local-only flags. Nothing is sent to a remote directory.</p>
        <div className="mt-5">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Role</label>
          <select
            value={draft.role}
            onChange={(e) => patch({ role: e.target.value })}
            className={`${inputCls} h-10 appearance-auto`}
          >
            {(OPERATOR_ROLES as readonly string[]).includes(draft.role) ? null : (
              <option value={draft.role}>{draft.role}</option>
            )}
            {OPERATOR_ROLES.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>
        <div className="mt-5 divide-y divide-slate-100">
          {PERMISSION_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-6 py-4 first:pt-1 last:pb-0">
              <div className="min-w-0 pr-4">
                <div className="text-sm font-medium text-slate-900">{row.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{row.hint}</div>
              </div>
              <Toggle
                on={draft.permissions[row.key]}
                onChange={(v) => patch({ permissions: { ...draft.permissions, [row.key]: v } })}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-2.5">
        <button type="button" onClick={onCancel}
          className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900">
          Revert / Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave({ ...draft, avatarInitials: displayInitials })}
          className="h-10 rounded-lg bg-blue-600 px-[18px] text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Profile Changes"}
        </button>
      </div>
    </div>
  );
}
