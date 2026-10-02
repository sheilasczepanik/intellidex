/** Bumped so a previous client-parse queue cannot satisfy Verify. */
export function extractionCacheKey(caseId: string, sourceId: string) {
  return `dossier_extractions_v3_${caseId}_${sourceId}`;
}

/** A one-card MM 1 cache cannot drive highlight matching. */
export function mm1QueueIsStale(queueLength: number) {
  return queueLength <= 1;
}

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
  extractEvidenceLocally,
  findingsFromDocumentText,
  runClientExtraction,
} from "./extractClient";
export {
  isLocalMauraExtractSource,
  mauraVerifiedBundle,
  MAURA_FALLBACK_ENTITIES,
} from "./mauraExtractFallback";
export { renderPdfPagesToJpeg } from "./pdfHelpers";
export { DYNAMIC_EXTRACTION_PROMPT, EXTRACT_PAGES_PER_CHUNK, splitPageChunks } from "./extractSchema";
export { MM_1_EXTRACTIONS, isMm1Source, mm1ExtractBundle, mm1ReportText } from "../data/caseFixtures";
