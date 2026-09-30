import type { ComponentType } from "react";
import { getCategoryColor, resolveSemanticCategory, type CategoryColorInput } from "./utils/categoryColors";
import { formatRoleLabel, roleDisplayClass, entityAvatarClass, entityInitials } from "./utils/roleBadge";
import MediaProvenanceBadge from "./MediaProvenanceBadge";

const mono = "font-mono";

export type DossierLane = {
  def: {
    id: string;
    name: string;
    role: string;
    note: string;
    category: CategoryColorInput;
    dot: string;
    uncorroborated?: boolean;
    entityId?: string;
  };
  count: number;
};

type Props = {
  open: boolean;
  selected: string | null;
  lanes: DossierLane[];
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  onPromoteEntity?: (id: string) => void;
  ToggleIcon: ComponentType<{ className?: string }>;
};

export default function EntityDossier({ open, selected, lanes, onToggle, onSelect, onPromoteEntity, ToggleIcon }: Props) {
  return (
    <aside className={`flex shrink-0 flex-col overflow-hidden border-slate-200 bg-slate-50/60 transition-[width] duration-200 max-lg:absolute max-lg:z-20 max-lg:h-full ${open ? "w-[min(268px,86vw)] border-r" : "w-0 border-0 max-lg:pointer-events-none lg:w-[58px] lg:border-r"}`}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2.5 border-b border-slate-200 pl-[18px] pr-3.5">
        {open && (
          <span className={`whitespace-nowrap ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>ENTITY DOSSIER</span>
        )}
        <button onClick={onToggle}
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900">
          <ToggleIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="flex flex-1 flex-col gap-1.5 overflow-auto px-3.5 pb-6 pt-4">
          {lanes.map(({ def, count }) => {
            const on = selected === def.id;
            const semantic = resolveSemanticCategory(def.category);
            return (
              <div key={def.id} onClick={() => onSelect(on ? null : def.id)}
                className={`cursor-pointer rounded-[10px] border p-3.5 transition-colors ${on ? "border-slate-300 bg-white" : "border-transparent hover:bg-slate-100/70"}`}>
                <div className="mb-2 flex items-center gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${entityAvatarClass(def.role, getCategoryColor(semantic, "badge"), def.note)}`}>
                    {entityInitials(def.name)}
                  </span>
                  <span className="min-w-0 truncate text-[13.5px] font-medium">{def.name}</span>
                </div>
                <div className={`mb-1.5 truncate whitespace-nowrap ${mono} text-[10.5px] tracking-[0.06em] text-slate-500`}>{def.role ? formatRoleLabel(def.role) : "ENTITY"}</div>
                <div className="text-[12px] leading-relaxed text-slate-500 text-pretty">{def.note || "No notes recorded."}</div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-md border px-[7px] py-0.5 ${mono} text-[10px] ${getCategoryColor(semantic, "badge")}`}>
                    {count} {count === 1 ? "EVENT" : "EVENTS"}
                  </span>
                  <span className={`inline-flex max-w-full shrink-0 items-center rounded-md border px-2 py-0.5 ${mono} text-[10px] tracking-[0.08em] whitespace-nowrap ${roleDisplayClass(def.role, getCategoryColor(semantic, "badge"))}`}>
                    {formatRoleLabel(def.role || "OPEN")}
                  </span>
                  <MediaProvenanceBadge
                    show={def.uncorroborated}
                    onPromote={def.entityId && onPromoteEntity ? () => onPromoteEntity(def.entityId!) : undefined}
                  />
                </div>
              </div>
            );
          })}
          {lanes.length === 0 && (
            <div className="rounded-[10px] border border-dashed border-slate-200 p-4 text-[12.5px] text-slate-500">
              No events on this case yet. Add an entity, then plot an event.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
