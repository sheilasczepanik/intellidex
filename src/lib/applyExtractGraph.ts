import { addRelationship, db, upsertEntityByName } from "../db";
import type { ExtractedRelationship, ExtractedRosterEntity } from "./extractSchema";
import { namesLooselyMatch } from "./eventTime";
import { isSecondaryEvidence } from "./sourceTier";
import { storedEntityType } from "../types";

export async function applyExtractedGraph(input: {
  caseId: string;
  evidenceId?: string;
  entities: ExtractedRosterEntity[];
  relationships: ExtractedRelationship[];
}) {
  const evidence = input.evidenceId ? await db.evidence.get(input.evidenceId) : undefined;
  const fromSecondary = evidence ? isSecondaryEvidence(evidence) : false;

  const resolved = new Map<string, string>();
  for (const ent of input.entities) {
    const row = await upsertEntityByName({
      caseId: input.caseId,
      name: ent.name,
      type: storedEntityType(ent.type),
      role: fromSecondary ? undefined : ent.classification,
      classification: fromSecondary ? undefined : ent.classification,
      identifiers: ent.identifiers,
      notes: fromSecondary ? (ent.classification ? `Reported classification: ${ent.classification}` : "") : undefined,
      fromSecondary,
    });
    if (row) resolved.set(ent.name.trim().toLowerCase(), row.id);
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
}
