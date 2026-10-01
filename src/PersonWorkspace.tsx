import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { GitCommitHorizontal, Link2, MapPin, PinOff, UserRound } from "lucide-react";
import { db, type CaseRecord, type EntityRecord, type EvidenceRecord, type TimelineEventRecord } from "./db";
import { RELATIONSHIP_LABELS } from "./types";
import { entityAvatarClass, entityInitials, formatRoleLabel } from "./utils/roleBadge";
import LocationsMap from "./LocationsMap";

const mono = "font-mono";

export type PersonLeaf = "overview" | "timeline" | "locations" | "media" | "linked";

export default function PersonWorkspace({
  activeCase,
  person,
  entities,
  events,
  evidence,
  leaf,
  onUnpin,
}: {
  activeCase: CaseRecord;
  person: EntityRecord;
  entities: EntityRecord[];
  events: TimelineEventRecord[];
  evidence: EvidenceRecord[];
  leaf: PersonLeaf;
  onUnpin: () => void;
}) {
  const relationships = useLiveQuery(
    () => db.relationships.where("caseId").equals(activeCase.id).toArray(),
    [activeCase.id],
  ) ?? [];
  const media = useLiveQuery(
    () => db.caseMedia.where("caseId").equals(activeCase.id).toArray(),
    [activeCase.id],
  ) ?? [];

  const nameKey = person.name.trim().toLowerCase();
  const personEvents = useMemo(
    () => events.filter((e) => {
      if (e.entityId === person.id) return true;
      const blob = `${e.title} ${e.description}`.toLowerCase();
      return nameKey.length > 2 && blob.includes(nameKey);
    }),
    [events, person.id, nameKey],
  );

  const linked = useMemo(() => {
    const edges = relationships.filter((r) => r.sourceEntityId === person.id || r.targetEntityId === person.id);
    return edges.map((edge) => {
      const otherId = edge.sourceEntityId === person.id ? edge.targetEntityId : edge.sourceEntityId;
      return { edge, other: entities.find((e) => e.id === otherId) };
    }).filter((row) => row.other);
  }, [relationships, person.id, entities]);

  const placeIds = new Set(
    linked.filter((row) => row.other && (row.other.type === "place" || row.other.type === "location")).map((row) => row.other!.id),
  );
  const places = entities.filter((e) => (e.type === "place" || e.type === "location") && (
    placeIds.has(e.id) || personEvents.some((ev) => ev.title.toLowerCase().includes(e.name.toLowerCase()) || ev.description.toLowerCase().includes(e.name.toLowerCase()))
  ));

  const statements = evidence.filter((ev) => {
    const blob = `${ev.fileName} ${ev.rawText || ""} ${ev.fullText || ""}`.toLowerCase();
    return nameKey.length > 2 && blob.includes(nameKey);
  });
  const relatedMedia = media.filter((row) => {
    const blob = `${row.title || ""} ${row.originalFileName || ""} ${row.description || ""} ${row.sourceUrl || ""}`.toLowerCase();
    return nameKey.length > 2 && (blob.includes(nameKey) || row.category === "witness_photo");
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${entityAvatarClass(person.role, "bg-slate-50 text-slate-700 border border-slate-200", person.notes, person.classification)}`}>
            {entityInitials(person.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight">{person.name}</h1>
              {person.role ? (
                <span className={`rounded-md border px-2 py-0.5 ${mono} text-[10.5px] tracking-[0.06em] text-slate-600`}>
                  {formatRoleLabel(person.role)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 max-w-[52ch] text-[13px] leading-relaxed text-slate-500">
              {person.notes || "No dossier notes recorded for this person."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onUnpin}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-600 hover:border-slate-300"
        >
          <PinOff className="h-3.5 w-3.5" />Unpin
        </button>
      </div>

      {leaf === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <StatCard icon={GitCommitHorizontal} label="Timeline events" value={String(personEvents.length)} />
          <StatCard icon={MapPin} label="Linked locations" value={String(places.length)} />
          <StatCard icon={Link2} label="Linked entities" value={String(linked.length)} />
          <StatCard icon={UserRound} label="Statements / sources" value={String(statements.length)} />
          {person.identifiers?.length ? (
            <div className="rounded-[14px] border border-slate-200 bg-white p-4 lg:col-span-2">
              <div className={`mb-2 ${mono} text-[11px] tracking-[0.12em] text-slate-500`}>IDENTIFIERS</div>
              <div className="flex flex-wrap gap-1.5">
                {person.identifiers.map((id) => (
                  <span key={id} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] text-slate-700">{id}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {leaf === "timeline" && (
        <div className="flex flex-col gap-3">
          {personEvents.length === 0 ? (
            <Empty>No events involving {person.name} yet.</Empty>
          ) : personEvents.map((ev) => (
            <article key={ev.id} className="rounded-[14px] border border-slate-200 bg-white p-4">
              <div className={`${mono} text-[11px] text-slate-500`}>
                {new Date(ev.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </div>
              <h2 className="mt-1 text-[15px] font-semibold">{ev.title}</h2>
              {ev.description ? <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{ev.description}</p> : null}
            </article>
          ))}
        </div>
      )}

      {leaf === "locations" && (
        <div className="flex min-h-[min(70vh,640px)] flex-col gap-3">
          {places.length === 0 && personEvents.length === 0 ? (
            <Empty>No sightings or addresses tied to {person.name} yet.</Empty>
          ) : (
            <LocationsMap activeCase={activeCase} places={places} events={personEvents} />
          )}
        </div>
      )}

      {leaf === "media" && (
        <div className="flex flex-col gap-3">
          {statements.length === 0 && relatedMedia.length === 0 ? (
            <Empty>No statements or media associated with {person.name} yet.</Empty>
          ) : (
            <>
              {statements.map((ev) => (
                <article key={ev.id} className="rounded-[14px] border border-slate-200 bg-white p-4">
                  <div className={`mb-1 ${mono} text-[11px] tracking-[0.08em] text-slate-500`}>SOURCE</div>
                  <div className="font-semibold">{ev.fileName}</div>
                  <p className="mt-1 line-clamp-4 text-[12.5px] leading-relaxed text-slate-600">{ev.rawText || ev.fullText || "No excerpt stored."}</p>
                </article>
              ))}
              {relatedMedia.map((row) => (
                <article key={row.id} className="rounded-[14px] border border-slate-200 bg-white p-4">
                  <div className={`mb-1 ${mono} text-[11px] tracking-[0.08em] text-slate-500`}>MEDIA · {row.category}</div>
                  <div className="font-semibold">{row.title || row.originalFileName || "Untitled"}</div>
                </article>
              ))}
            </>
          )}
        </div>
      )}

      {leaf === "linked" && (
        <div className="flex flex-col gap-3">
          {linked.length === 0 ? (
            <Empty>No cross-links from {person.name} to vehicles, phones, or other subjects.</Empty>
          ) : linked.map(({ edge, other }) => (
            <article key={edge.id} className="flex items-center gap-3 rounded-[14px] border border-slate-200 bg-white p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold ${entityAvatarClass(other!.role)}`}>
                {entityInitials(other!.name)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{other!.name}</div>
                <div className={`${mono} text-[11px] text-slate-500`}>
                  {RELATIONSHIP_LABELS[edge.relationshipType] || edge.label || edge.relationshipType} · {other!.type}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className={`${mono} text-[11px] tracking-[0.1em]`}>{label.toUpperCase()}</span>
      </div>
      <div className="text-[28px] font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-[13px] text-slate-500">
      {children}
    </div>
  );
}
