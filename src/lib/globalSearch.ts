import { db, type CaseContactRecord } from "../db/schema";
import { formatRoleLabel } from "../utils/roleBadge";

export type SearchGroup = "Cases" | "Entities" | "Events" | "Evidence" | "Contacts";

export type SearchHit = {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle: string;
  caseId: string;
  caseTitle: string;
  kind: "case" | "entity" | "event" | "evidence" | "contact";
};

function hay(...parts: Array<string | number | undefined | null>) {
  return parts.map((p) => String(p ?? "")).join(" ").toLowerCase();
}

function snippetAround(text: string, q: string, width = 72) {
  const lower = text.toLowerCase();
  const i = lower.indexOf(q);
  if (i < 0) return text.slice(0, width).trim();
  const start = Math.max(0, i - 24);
  const slice = text.slice(start, i + q.length + width - 24).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${i + q.length + width < text.length ? "…" : ""}`;
}

export async function searchDossier(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const [cases, entities, events, evidence, contacts] = await Promise.all([
    db.cases.toArray(),
    db.entities.toArray(),
    db.timelineEvents.toArray(),
    db.evidence.toArray(),
    db.caseContacts.toArray().catch(() => [] as CaseContactRecord[]),
  ]);
  const caseTitle = (id: string) => cases.find((c) => c.id === id)?.title ?? id;
  const hits: SearchHit[] = [];

  for (const c of cases) {
    if (hay(c.id, c.title, c.jurisdiction, c.summary, c.status).includes(q)) {
      hits.push({
        id: `case:${c.id}`,
        group: "Cases",
        title: c.title,
        subtitle: `${c.id}${c.jurisdiction ? ` · ${c.jurisdiction}` : ""}`,
        caseId: c.id,
        caseTitle: c.title,
        kind: "case",
      });
    }
  }

  for (const e of entities) {
    if (hay(e.name, e.role, e.type, e.notes).includes(q)) {
      hits.push({
        id: `entity:${e.id}`,
        group: "Entities",
        title: e.name,
        subtitle: `${caseTitle(e.caseId)} · ${formatRoleLabel(e.role) || e.type}`,
        caseId: e.caseId,
        caseTitle: caseTitle(e.caseId),
        kind: "entity",
      });
    }
  }

  for (const ev of events) {
    const stamp = new Date(ev.timestamp).toLocaleString();
    if (hay(ev.title, ev.description, stamp).includes(q)) {
      hits.push({
        id: `event:${ev.id}`,
        group: "Events",
        title: ev.title,
        subtitle: `${caseTitle(ev.caseId)} · ${stamp}`,
        caseId: ev.caseId,
        caseTitle: caseTitle(ev.caseId),
        kind: "event",
      });
    }
  }

  for (const ev of evidence) {
    const blob = hay(ev.fileName, ev.fileType, (ev.fullText || ev.rawText).slice(0, 12000));
    if (blob.includes(q)) {
      hits.push({
        id: `evidence:${ev.id}`,
        group: "Evidence",
        title: ev.fileName,
        subtitle: snippetAround(ev.fullText || ev.rawText || ev.fileType, q),
        caseId: ev.caseId,
        caseTitle: caseTitle(ev.caseId),
        kind: "evidence",
      });
    }
  }

  for (const c of contacts) {
    if (hay(c.name, c.affiliation, c.phone, c.email, c.address, c.notes).includes(q)) {
      hits.push({
        id: `contact:${c.id}`,
        group: "Contacts",
        title: c.name,
        subtitle: `${caseTitle(c.caseId)} · ${c.affiliation}`,
        caseId: c.caseId,
        caseTitle: caseTitle(c.caseId),
        kind: "contact",
      });
    }
  }

  return hits.slice(0, 48);
}
