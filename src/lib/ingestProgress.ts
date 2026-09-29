export type IngestStage = "pdf" | "render" | "claude" | "events" | "done";

export type IngestJob = {
  evidenceId: string;
  stage: IngestStage;
  currentPage: number;
  totalPages: number;
  startedAt: number;
  llmStartedAt: number | null;
};

export function ingestStageLabel(job: IngestJob) {
  if (job.stage === "pdf" || job.stage === "render") {
    const start = 1;
    const end = Math.max(job.currentPage, job.totalPages, 1);
    return `Rendering pages ${start}-${end}...`;
  }
  if (job.stage === "claude") return "Analyzing evidence with Claude...";
  if (job.stage === "events") return "Extracting candidate events...";
  return "Done";
}

export function ingestPercent(job: IngestJob, now: number) {
  if (job.stage === "done") return 100;
  if (job.stage === "pdf" || job.stage === "render") {
    if (!job.totalPages) return 6;
    return Math.max(6, Math.round((job.currentPage / job.totalPages) * 38));
  }
  const origin = job.llmStartedAt ?? job.startedAt;
  const elapsed = Math.max(0, (now - origin) / 1000);
  if (job.stage === "events") {
    return Math.min(97, 88 + Math.round(elapsed * 2));
  }
  return Math.min(90, 44 + Math.round(elapsed * 1.6));
}

export function ingestElapsedSec(job: IngestJob, now: number) {
  return Math.max(0, Math.floor((now - job.startedAt) / 1000));
}
