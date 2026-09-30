import type { ComponentType } from "react";
import { Check, Link2, Trash2, X } from "lucide-react";
import type { WizardFormState, EntityKind, KindSchema } from "./entityTypes";
import { formatRoleButtonLabel, normalizePersonRole, roleBadgeClass, entityAvatarClass, entityInitials } from "./utils/roleBadge";
import MediaProvenanceBadge from "./MediaProvenanceBadge";

const mono = "font-mono";

type Props = {
  form: WizardFormState;
  schema: KindSchema;
  Icon: ComponentType<{ className?: string }>;
  inputCls: string;
  uncorroborated?: boolean;
  onPromote?: () => void;
  onChange: (next: WizardFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
};

export default function EditEntityDrawer({
  form, schema, Icon, inputCls, uncorroborated, onPromote, onChange, onSave, onCancel, onRemove,
}: Props) {
  const setV = (k: string, val: string) => onChange({ ...form, v: { ...form.v, [k]: val } });
  const meta = schema.fields.map((f) => form.v[f.k]).filter(Boolean).join(" · ");

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/30 backdrop-blur-[2px]">
      <div className="flex-1" onClick={onCancel} />
      <div className="flex h-full w-[460px] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start gap-3.5 border-b border-slate-200 px-6 pb-[18px] pt-[22px]">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center text-[12px] font-bold ${form.tab === "People"
            ? `rounded-full ${entityAvatarClass(form.chip)}`
            : "rounded-xl border border-blue-200 bg-blue-50 text-blue-700"}`}>
            {form.tab === "People" ? entityInitials(form.name || "Person") : <Icon className="h-[18px] w-[18px]" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="mb-1 text-[17px] font-bold capitalize tracking-tight">
              {form.id == null ? "Add " : "Edit "}{schema.noun}
            </h2>
            <p className="text-[12.5px] leading-relaxed text-slate-500 text-pretty">
              {form.id == null
                ? `New record in ${form.tab.toLowerCase()} — it joins the case the moment you save.`
                : "Changes apply everywhere this entity is referenced."}
            </p>
            <div className="mt-2">
              <MediaProvenanceBadge show={uncorroborated} onPromote={onPromote} />
            </div>
          </div>
          <button onClick={onCancel}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X className="h-[15px] w-[15px]" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-[22px] overflow-auto px-6 pb-7 pt-[22px]">
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-semibold text-slate-700">Name</label>
            <input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })}
              placeholder="Start typing a name" className={`${inputCls} h-11 text-[15px] font-semibold`} />
          </div>

          <div className="flex flex-col gap-2.5">
            <label className="text-[12px] font-semibold text-slate-700">Status in case</label>
            <div className="flex flex-wrap gap-2">
              {schema.statuses.map((st) => {
                const on = normalizePersonRole(form.chip) === st || form.chip === st;
                return (
                  <button key={st} type="button" onClick={() => onChange({ ...form, chip: st })}
                    className={`inline-flex h-[30px] max-w-full shrink-0 items-center gap-1.5 rounded-lg px-3 ${mono} text-[10.5px] tracking-[0.08em] whitespace-nowrap transition-all ${roleBadgeClass(st, on)}`}>
                    {on ? <Check className="h-3 w-3 shrink-0" aria-hidden /> : null}
                    {formatRoleButtonLabel(st)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {schema.fields.map((fd) => (
              <div key={fd.k} className={`flex flex-col gap-2 ${fd.half ? "col-span-1" : "col-span-1 sm:col-span-2"}`}>
                <label className="text-[12px] font-semibold text-slate-700">{fd.label}</label>
                {fd.area ? (
                  <textarea value={form.v[fd.k] ?? ""} onChange={(e) => setV(fd.k, e.target.value)}
                    placeholder={fd.ph} className={`${inputCls} h-[76px] resize-none py-2.5 text-[13.5px] leading-relaxed`} />
                ) : (
                  <input value={form.v[fd.k] ?? ""} onChange={(e) => setV(fd.k, e.target.value)}
                    placeholder={fd.ph} className={`${inputCls} h-10 text-[13.5px]`} />
                )}
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className={`mb-2.5 ${mono} text-[10px] tracking-[0.14em] text-slate-500`}>HOW IT WILL READ</div>
            <div className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-3">
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-slate-200 bg-white text-slate-500">
                <Icon className="h-[15px] w-[15px]" />
              </div>
              <div className="min-w-0">
                <div className="mb-0.5 truncate text-[13.5px] font-semibold">{form.name || "Untitled"}</div>
                <div className={`truncate ${mono} text-[11px] text-slate-500`}>{meta || "No details yet"}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-slate-200 pt-3 text-[11.5px] text-slate-500">
              <Link2 className="h-3.5 w-3.5 shrink-0" />
              {form.id == null ? "Will be linked to this case in IndexedDB" : `Record ${form.id.slice(0, 8)}`}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 border-t border-slate-200 bg-white px-6 py-4">
          {form.id != null && (
            <button onClick={onRemove}
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] border border-red-200 px-3.5 text-[13px] font-medium text-red-700 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" />Remove
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onCancel}
            className="h-10 whitespace-nowrap rounded-[10px] border border-slate-300 px-4 text-[13px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
            Cancel
          </button>
          <button onClick={onSave}
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] bg-blue-600 px-[18px] text-[13px] font-semibold text-white transition-colors hover:bg-blue-700">
            <Check className="h-3.5 w-3.5" />Save entity
          </button>
        </div>
      </div>
    </div>
  );
}

export type { EntityKind };
