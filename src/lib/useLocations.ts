import { useCallback, useState } from "react";
import { db, deleteEntity, updateEntity } from "../db";

/** Remove a place and detach chronology events so they stay on the timeline unassigned. */
export async function deleteLocation(id: string) {
  const rec = await db.entities.get(id);
  if (!rec) return;
  await db.transaction("rw", db.entities, db.timelineEvents, db.caseContacts, db.relationships, db.cases, async () => {
    await db.timelineEvents.where("entityId").equals(id).modify({ entityId: "" });
    const contacts = await db.caseContacts.where("entityId").equals(id).toArray();
    await Promise.all(contacts.map((contact) => db.caseContacts.update(contact.id, { entityId: "" })));
    const edges = await db.relationships.where("caseId").equals(rec.caseId).toArray();
    const drop = edges
      .filter((edge) => edge.sourceEntityId === id || edge.targetEntityId === id)
      .map((edge) => edge.id);
    if (drop.length) await db.relationships.bulkDelete(drop);
    await db.entities.delete(id);
    await db.cases.update(rec.caseId, { updatedAt: Date.now() });
  });
}

/** Move every timeline event from the duplicate onto the target, then delete the duplicate place. */
export async function mergeLocations(targetId: string, duplicateId: string) {
  if (!targetId || !duplicateId || targetId === duplicateId) return null;
  const target = await db.entities.get(targetId);
  const duplicate = await db.entities.get(duplicateId);
  if (!target || !duplicate) return null;

  await db.timelineEvents.where("entityId").equals(duplicateId).modify({ entityId: targetId });

  const edges = await db.relationships.where("caseId").equals(duplicate.caseId).toArray();
  for (const edge of edges) {
    if (edge.sourceEntityId !== duplicateId && edge.targetEntityId !== duplicateId) continue;
    const sourceEntityId = edge.sourceEntityId === duplicateId ? targetId : edge.sourceEntityId;
    const targetEntityId = edge.targetEntityId === duplicateId ? targetId : edge.targetEntityId;
    if (sourceEntityId === targetEntityId) {
      await db.relationships.delete(edge.id);
      continue;
    }
    await db.relationships.update(edge.id, { sourceEntityId, targetEntityId });
  }

  const contacts = await db.caseContacts.where("entityId").equals(duplicateId).toArray();
  await Promise.all(contacts.map((contact) => db.caseContacts.update(contact.id, { entityId: targetId })));

  const metadata = { ...(target.metadata || {}) };
  if (!metadata.coordinates && (duplicate.metadata?.coordinates || duplicate.metadata?.coords)) {
    metadata.coordinates = duplicate.metadata?.coordinates || duplicate.metadata?.coords || "";
  }
  if (!metadata.address && duplicate.metadata?.address) metadata.address = duplicate.metadata.address;
  if (!metadata.photoUrl && duplicate.metadata?.photoUrl) metadata.photoUrl = duplicate.metadata.photoUrl;
  const mergedFrom = [
    ...(metadata.mergedFrom ? metadata.mergedFrom.split(",").map((part) => part.trim()).filter(Boolean) : []),
    duplicateId,
  ];
  metadata.mergedFrom = [...new Set(mergedFrom)].join(",");
  await updateEntity(targetId, {
    notes: [target.notes, duplicate.notes].filter(Boolean).join("\n"),
    metadata,
  });
  await deleteEntity(duplicateId);
  return targetId;
}

export function useLocations() {
  const [busy, setBusy] = useState(false);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await deleteLocation(id);
    } finally {
      setBusy(false);
    }
  }, []);

  const merge = useCallback(async (targetId: string, duplicateId: string) => {
    setBusy(true);
    try {
      return await mergeLocations(targetId, duplicateId);
    } finally {
      setBusy(false);
    }
  }, []);

  return { deleteLocation: remove, mergeLocations: merge, busy };
}
