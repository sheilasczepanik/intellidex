import { useMemo, useState } from "react";
import { Pin, ArrowRight } from "lucide-react";
import type { CaseRecord, EntityRecord, TimelineEventRecord } from "./db";
import { personRoleTab, type PersonRoleTab } from "./lib/personDirectory";
import { entityAvatarClass, entityInitials, formatRoleLabel } from "./utils/roleBadge";

const mono = "font-mono";

const TABS: { id: PersonRoleTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "witness", label: "Witnesses" },
  { id: "law", label: "Law Enforcement" },
  { id: "family", label: "Family" },
  { id: "poi", label: "POIs" },
];

export default function HubPersons({
  people,
  cases,
  events,
  onOpenCase,
  onPin,
}: {
  people: EntityRecord[];
  cases: CaseRecord[];
  events: TimelineEventRecord[];
  onOpenCase: (caseId: string) => void;
  onPin: (personId: string, caseId: string) => void;
}) {
  const [tab, setTab] = useState<PersonRoleTab>("all");
  const rows = useMemo(() => {
    const caseMap = new Map(cases.map((row) => [row.id, row]));
    return people
      .filter((person) => tab === "all" || personRoleTab(person) === tab)
      .map((person) => {
        const caseRec = caseMap.get(person.caseId);
        const needle = person.name.trim().toLowerCase();
        const eventCount = events.filter((event) => {
          if (event.caseId !== person.caseId) return false;
          if (event.entityId === person.id) return true;
          return `${event.title} ${event.description}`.toLowerCase().includes(needle);
        }).length;
        return { person, caseRec, eventCount };
      })
      .sort((a, b) => a.person.name.localeCompare(b.person.name));
  }, [people, cases, events, tab]);

  return (
    <section className="mt-14">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">Persons directory</h2>
          <p className="mt-1 text-[13px] text-slate-500">Witnesses, investigators, family, and persons of interest across every case on this machine.</p>
        </div>
        <span className={`${mono} text-[11px] text-slate-500`}>{rows.length} PEOPLE</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-full border border-slate-200 bg-slate-100 p-0.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${tab === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-[13px] text-slate-500">
          No people in this role yet.
        </div>
      ) : (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
          {rows.map(({ person, caseRec, eventCount }) => {
            const pinned = (caseRec?.pinnedPersonIds ?? []).includes(person.id);
            const caseLabel = caseRec ? `${caseRec.id} · ${caseRec.subjectName || caseRec.title}` : person.caseId;
            return (
              <article key={person.id} className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${entityAvatarClass(person.role, "bg-slate-50 text-slate-700 border border-slate-200", person.notes, person.classification)}`}>
                    {entityInitials(person.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold">{person.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className={`inline-flex rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.04em] text-slate-600`}>
                        {formatRoleLabel(person.role) || "Person"}
                      </span>
                      <span className={`inline-flex max-w-full truncate rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 ${mono} text-[10px] tracking-[0.04em] text-blue-800`}>
                        {caseLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <div className={`mb-3 ${mono} text-[11px] text-slate-500`}>{eventCount} {eventCount === 1 ? "EVENT" : "EVENTS"}</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenCase(person.caseId)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-slate-300 px-2.5 text-[12px] font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700"
                  >
                    Open Case Workspace <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPin(person.id, person.caseId)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold ${pinned ? "border border-blue-200 bg-blue-50 text-blue-800" : "bg-slate-900 text-white hover:bg-slate-800"}`}
                  >
                    <Pin className="h-3.5 w-3.5" />{pinned ? "Pinned" : "Pin to Workspace"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
