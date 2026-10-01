import { CASE_MEDIA_CATEGORIES, type CaseMediaCategory } from "../db/schema";

export const MEDIA_CATEGORY_LABEL: Record<(typeof CASE_MEDIA_CATEGORIES)[number], string> = {
  subject_flyer: "Subject flyer",
  surveillance: "Surveillance",
  ping_data: "Ping data",
  witness_photo: "Witness photo",
  search_log: "Search log",
  uncategorized: "Uncategorized",
};

export const ADD_MEDIA_CATEGORY_VALUE = "__add_new_category__";

export function isBuiltinMediaCategory(id: string): id is (typeof CASE_MEDIA_CATEGORIES)[number] {
  return (CASE_MEDIA_CATEGORIES as readonly string[]).includes(id);
}

export function sanitizeMediaCategoryLabel(raw: string) {
  return raw.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function customMediaCategoryId(label: string) {
  const slug = sanitizeMediaCategoryLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    || "category";
  return `custom:${slug}`;
}

export function mediaCategoryLabel(id: string, customLabels: string[] = []) {
  if (isBuiltinMediaCategory(id)) return MEDIA_CATEGORY_LABEL[id];
  const match = customLabels.find((label) => customMediaCategoryId(label) === id);
  if (match) return match;
  if (id.startsWith("custom:")) return id.slice(7).replace(/_/g, " ");
  return id;
}

export function categoryAlreadyExists(label: string, customLabels: string[]) {
  const needle = sanitizeMediaCategoryLabel(label).toLowerCase();
  if (!needle) return true;
  if (CASE_MEDIA_CATEGORIES.some((id) => id === needle || MEDIA_CATEGORY_LABEL[id].toLowerCase() === needle)) return true;
  const nextId = customMediaCategoryId(label);
  return customLabels.some((row) => row.toLowerCase() === needle || customMediaCategoryId(row) === nextId);
}

export type { CaseMediaCategory };
