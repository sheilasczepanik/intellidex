import { addRelationship, createCaseContact, db, updateCase, upsertEntityByName } from "../db";
import type { ExtractBundle, ExtractedRelationship, ExtractedRosterEntity } from "./extractSchema";
import { namesLooselyMatch } from "./eventTime";
import { mapContactAffiliation } from "./missingPerson";
import { isSecondaryEvidence } from "./sourceTier";
import { storedEntityType } from "../types";

export async function applyExtractedGraph(input: {
  caseId: string;
  evidenceId?: string;
  entities: ExtractedRosterEntity[];
  relationships: ExtractedRelationship[];
  bundle?: ExtractBundle;
}) {
  const evidence = input.evidenceId ? await db.evidence.get(input.evidenceId) : undefined;
  const fromSecondary = evidence ? isSecondaryEvidence(evidence) : false;
  const bundle = input.bundle;

  const resolved = new Map<string, string>();
  for (const ent of input.entities) {
    const locKind = /last_seen|item_recovered|cell_ping|search_grid/.test(ent.classification || "")
      ? ent.classification
      : undefined;
    const row = await upsertEntityByName({
      caseId: input.caseId,
      name: ent.name,
      type: storedEntityType(ent.type),
      role: fromSecondary ? undefined : ent.classification,
      classification: fromSecondary ? undefined : ent.classification,
      identifiers: ent.identifiers,
      notes: fromSecondary
        ? (ent.classification ? `Reported classification: ${ent.classification}` : ent.contextSnippet)
        : ent.contextSnippet,
      metadata: locKind
        ? { locationKind: locKind, searchStatus: "Unchecked" }
        : undefined,
      fromSecondary,
    });
    if (row) resolved.set(ent.name.trim().toLowerCase(), row.id);
  }

  for (const loc of bundle?.searchLocations ?? []) {
    await upsertEntityByName({
      caseId: input.caseId,
      name: loc.name,
      type: "place",
      role: loc.type,
      classification: loc.type,
      notes: loc.description,
      metadata: { locationKind: loc.type, searchStatus: "Unchecked" },
      fromSecondary,
    });
  }

  const roster = await db.entities.where("caseId").equals(input.caseId).toArray();
  const findId = (name: string) => {
    const key = name.trim().toLowerCase();
    if (resolved.get(key)) return resolved.get(key);
    const hit = roster.find((e) => e.name.trim().toLowerCase() === key)
      ?? roster.find((e) => namesLooselyMatch(e.name, name));
    return hit?.id;
  };

  for (const rel of input.relationships) {
    let sourceId = findId(rel.sourceEntity);
    let targetId = findId(rel.targetEntity);
    if (!sourceId) {
      const created = await upsertEntityByName({
        caseId: input.caseId,
        name: rel.sourceEntity,
        type: rel.sourceType,
        role: "UNVERIFIED",
        fromSecondary,
      });
      sourceId = created?.id;
    }
    if (!targetId) {
      const created = await upsertEntityByName({
        caseId: input.caseId,
        name: rel.targetEntity,
        type: rel.targetType,
        role: "UNVERIFIED",
        fromSecondary,
      });
      targetId = created?.id;
    }
    if (!sourceId || !targetId) continue;
    await addRelationship({
      caseId: input.caseId,
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      relationshipType: rel.relationshipType,
      label: rel.label,
      confidence: fromSecondary ? Math.min(rel.confidence, 0.45) : rel.confidence,
      sourceCitationId: input.evidenceId,
    });
  }

  const rec = await db.cases.get(input.caseId);
  if (rec && (bundle?.subject || bundle?.lks)) {
    const profile = { ...(rec.subjectProfile ?? {}) };
    if (bundle.subject?.age && !profile.ageAtDisappearance) profile.ageAtDisappearance = bundle.subject.age;
    if (bundle.subject?.clothingLastSeen && !profile.clothingLastSeen) profile.clothingLastSeen = bundle.subject.clothingLastSeen;
    if (bundle.subject?.identifyingMarks?.length && !profile.distinguishingMarks) {
      profile.distinguishingMarks = bundle.subject.identifyingMarks.join("; ");
    }
    if (bundle.subject?.medicalVulnerabilities?.length && !profile.medicalAlerts) {
      profile.medicalAlerts = bundle.subject.medicalVulnerabilities.join("; ");
    }
    const lksAt = bundle.lks?.date
      ? `${bundle.lks.date}${bundle.lks.time ? `T${bundle.lks.time.length === 5 ? bundle.lks.time : bundle.lks.time}` : ""}`
      : rec.lksAt;
    await updateCase(input.caseId, {
      subjectName: rec.subjectName || bundle.subject?.name || rec.title,
      title: rec.subjectName || bundle.subject?.name || rec.title,
      lksAt: rec.lksAt || lksAt,
      lksLocation: rec.lksLocation || bundle.lks?.location || rec.jurisdiction,
      lksCircumstances: rec.lksCircumstances || bundle.lks?.circumstances || "",
      jurisdiction: rec.jurisdiction || bundle.lks?.location || "",
      subjectProfile: profile,
    });
  }

  if (bundle?.contacts?.length) {
    const existing = await db.caseContacts.where("caseId").equals(input.caseId).toArray();
    const names = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    for (const c of bundle.contacts) {
      const key = c.name.trim().toLowerCase();
      if (names.has(key)) continue;
      names.add(key);
      await createCaseContact({
        caseId: input.caseId,
        name: c.name,
        affiliation: mapContactAffiliation(c.role, c.relation),
        entityId: findId(c.name) ?? "",
        phone: "",
        email: "",
        address: "",
        notes: c.relation || c.role,
      });
    }
  }
}
