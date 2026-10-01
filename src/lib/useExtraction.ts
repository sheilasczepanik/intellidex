/** Drafts that belong to the document currently open in Verify. */
export function draftsForSource<T extends { evidenceId: string }>(drafts: T[], evidenceId?: string | null) {
  if (!evidenceId) return [];
  return drafts.filter((draft) => draft.evidenceId === evidenceId);
}

/** Client-side extract path for Verify ingest and Re-run Extraction. */
export {
  extractEventsFromRenderedPages,
  extractEventsFromImage,
  extractEventsFromText,
} from "./extractClient";
export {
  isLocalMauraExtractSource,
  mauraVerifiedBundle,
  MAURA_FALLBACK_ENTITIES,
} from "./mauraExtractFallback";
export { renderPdfPagesToJpeg } from "./pdfHelpers";
