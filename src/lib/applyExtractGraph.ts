import { addRelationship, db, upsertEntityByName } from "../db";
import type { ExtractedRelationship, ExtractedRosterEntity } from "./extractSchema";
import { namesLooselyMatch } from "./eventTime";
import { storedEntityType } from "../types";

export async function applyExtractedGraph(input: {
  caseId: string;
  evidenceId?: string;
  entities: ExtractedRosterEntity[];
  relationships: ExtractedRelationship[];
}) {
  const resolved = new Map<string, string>();
  for (const ent of input.entities) {
    const row = await upsertEntityByName({
      caseId: input.caseId,
      name: ent.name,
      type: storedEntityType(ent.type),
      role: ent.classification,
      classification: ent.classification,
      identifiers: ent.identifiers,
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
      });
      sourceId = created?.id;
    }
    if (!targetId) {
      const created = await upsertEntityByName({
        caseId: input.caseId,
        name: rel.targetEntity,
        type: rel.targetType,
        role: "UNVERIFIED",
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
      confidence: rel.confidence,
      sourceCitationId: input.evidenceId,
    });
  }
}
