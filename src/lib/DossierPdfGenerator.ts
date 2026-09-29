import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CaseRecord, EntityRecord, EvidenceRecord, TimelineEventRecord, UserProfile } from "../db/schema";
import { formatRoleLabel } from "../utils/roleBadge";
import { inferSourceType } from "../types";
import { detectTimelineConflicts } from "./contradictions";
import {
  downloadBlob,
  exportDateStamp,
  safeExportSlug,
} from "./cryptoUtils";

export type DossierExportFormat = "pdf" | "json";

export interface DossierExportOptions {
  format: DossierExportFormat;
  cover: boolean;
  custody: boolean;
  chronology: boolean;
  contradictions: boolean;
  exhibits: boolean;
  redact: boolean;
}

export interface DossierExportPayload {
  case: CaseRecord;
  entities: EntityRecord[];
  evidence: EvidenceRecord[];
  events: TimelineEventRecord[];
  operator: UserProfile;
}

const CLASSIFICATION = "CONFIDENTIAL // AUDITED INVESTIGATIVE BRIEFING";

function operatorName(op: UserProfile) {
  return op.creatorName?.trim() || `${op.firstName} ${op.lastName}`.trim() || op.callsign;
}

function sourceTypeLabel(ev: EvidenceRecord) {
  const kind = inferSourceType(ev);
  if (kind === "web_article") return "Web article";
  if (kind === "external_intel") return "External intel";
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  return "Text";
}

function fmtWhen(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function exhibitNumber(index: number) {
  return `EX-${String(index + 1).padStart(3, "0")}`;
}

function mimeOf(ev: EvidenceRecord) {
  return ev.mimeType || ev.mediaType || (ev.fileType === "pdf" ? "application/pdf" : ev.fileType);
}

function sizeOf(ev: EvidenceRecord) {
  return ev.byteSize ?? ev.fileSize ?? 0;
}

function redactText(text: string, redact: boolean) {
  if (!redact) return text;
  return text
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED PHONE]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]");
}

function suspects(entities: EntityRecord[]) {
  const people = entities.filter((e) => e.type === "person");
  const hot = people.filter((e) => {
    const role = `${e.classification || ""} ${e.role}`.toLowerCase();
    return /suspect|subject|person_of_interest|poi|victim/.test(role);
  });
  return (hot.length ? hot : people).slice(0, 8);
}

function chromeHeader(doc: jsPDF, caseId: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, w, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.text("INTELLIDEX", w - 40, 16, { align: "right" });
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.text(caseId, 40, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(CLASSIFICATION, 40, 28);
  doc.setTextColor(20, 20, 20);
}

function tableFinalY(doc: jsPDF, fallback: number) {
  const last = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return (last?.finalY ?? fallback) + 24;
}

function applyFooters(doc: jsPDF, caseId: string) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    chromeHeader(doc, caseId);
    doc.setDrawColor(203, 213, 225);
    doc.line(40, h - 32, w - 40, h - 32);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${caseId}  ·  LOCAL VAULT  ·  NOT TRANSMITTED`, 40, h - 18);
    doc.text(`Page ${i} of ${pages}`, w - 40, h - 18, { align: "right" });
  }
}

function addSectionTitle(doc: jsPDF, title: string, y: number) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 80) {
    doc.addPage();
    y = 56;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 40, y);
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(1.2);
  doc.line(40, y + 6, 200, y + 6);
  return y + 22;
}

export async function buildOfficialDossierPdf(
  payload: DossierExportPayload,
  options: DossierExportOptions,
): Promise<Uint8Array> {
  const { case: rec, entities, evidence, events, operator } = payload;
  const conflicts = detectTimelineConflicts(events, entities);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const exportAt = new Date().toISOString();
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 56;

  if (options.cover) {
    y = addSectionTitle(doc, "1. Executive Cover Page", y);
    doc.setFont("courier", "bold");
    doc.setFontSize(11);
    doc.text("INTELLIDEX  ·  INVESTIGATIVE EVIDENCE & TIMELINE WORKBENCH", 40, y);
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(rec.title, 40, y);
    y += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const summary = doc.splitTextToSize(rec.summary || "No case summary on file.", pageW - 80);
    doc.text(summary, 40, y);
    y += summary.length * 13 + 10;
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    doc.text(`Jurisdiction: ${rec.jurisdiction?.trim() || "Unassigned"}`, 40, y);
    y += 14;
    doc.text(`Status: ${rec.status}${rec.isArchived ? "  ·  ARCHIVED" : ""}`, 40, y);
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Primary suspects / persons of interest", 40, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    const poi = suspects(entities);
    if (!poi.length) {
      doc.text("None recorded on the roster.", 40, y);
      y += 14;
    } else {
      poi.forEach((p) => {
        doc.text(`•  ${p.name}  —  ${formatRoleLabel(p.classification || p.role)}`, 48, y);
        y += 13;
      });
    }
    y += 8;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(40, y, pageW - 80, 88, 6, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Exported by", 52, y + 16);
    doc.setFont("helvetica", "normal");
    [
      `Creator: ${operatorName(operator)}`,
      `Show: ${operator.showTitle?.trim() || "—"}    Role: ${operator.role}`,
      `Export timestamp: ${exportAt}`,
    ].forEach((line, i) => doc.text(line, 52, y + 32 + i * 13));
    y += 106;

    const attestH = 72;
    if (y + attestH > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 56;
    }
    doc.setFillColor(236, 253, 245);
    doc.roundedRect(40, y, pageW - 80, attestH, 6, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(6, 95, 70);
    doc.text("Export statement", 52, y + 16);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "normal");
    const attest = doc.splitTextToSize(
      "Sources listed in this briefing were stored locally on this machine. No case bytes were transmitted to a remote server to produce this file.",
      pageW - 104,
    );
    doc.text(attest, 52, y + 32);
    y += attestH + 18;
  }

  if (options.custody) {
    y = addSectionTitle(doc, "2. Evidence Inventory", y);
    autoTable(doc, {
      startY: y,
      margin: { left: 40, right: 40, top: 48, bottom: 44 },
      head: [["Exhibit #", "Original filename", "Source Type", "Date Added"]],
      body: evidence.map((ev, i) => [
        exhibitNumber(i),
        ev.originalFileName || ev.fileName,
        sourceTypeLabel(ev),
        ev.ingestedAt ? fmtWhen(Date.parse(ev.ingestedAt)) : "—",
      ]),
      styles: { font: "helvetica", fontSize: 7, cellPadding: 4, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 48, font: "courier" },
      },
    });
    y = tableFinalY(doc, y);
  }

  if (options.chronology) {
    y = addSectionTitle(doc, "3. Verified Investigative Chronology", y);
    const conflictIds = new Set(conflicts.flatMap((c) => [c.aId, c.bId]));
    const rows = [...events].sort((a, b) => a.timestamp - b.timestamp).map((e) => {
      const ent = entityById.get(e.entityId);
      const src = evidenceById.get(e.sourceDocId);
      const cite = e.sourceCitation;
      const srcLabel = cite
        ? `${cite.sourceName}${cite.pageNumber ? ` p.${cite.pageNumber}` : ""}`
        : (src?.fileName || e.sourceDocId || "—");
      const disputed = conflictIds.has(e.id) || !e.isVerified;
      return [
        fmtWhen(e.timestamp),
        (cite ? "cited" : "event").toUpperCase(),
        ent?.name || "Unassigned",
        redactText(`${e.title}. ${e.description}`.trim(), options.redact),
        srcLabel,
        disputed ? (e.isVerified ? "DISPUTED" : "UNVERIFIED") : "VERIFIED",
      ];
    });
    autoTable(doc, {
      startY: y,
      margin: { left: 40, right: 40, top: 48, bottom: 44 },
      head: [["Timestamp", "Category", "Entity", "Observed finding", "Source citation", "Status"]],
      body: rows.length ? rows : [["—", "—", "—", "No chronology events on this case.", "—", "—"]],
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 4, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      didParseCell: (hook) => {
        if (hook.section !== "body") return;
        const status = String((hook.row.raw as string[] | undefined)?.[5] ?? "");
        if (status === "DISPUTED") {
          hook.cell.styles.fillColor = [254, 226, 226];
          hook.cell.styles.textColor = [153, 27, 27];
        } else if (status === "UNVERIFIED") {
          hook.cell.styles.fillColor = [255, 251, 235];
          hook.cell.styles.textColor = [146, 64, 14];
        }
      },
    });
    y = tableFinalY(doc, y);
  }

  if (options.contradictions) {
    y = addSectionTitle(doc, "4. Conflict & Contradiction Audit", y);
    if (!conflicts.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("No chronological collisions are currently flagged on this case.", 40, y);
      y += 20;
    } else {
      const body = conflicts.map((c, i) => {
        const a = events.find((e) => e.id === c.aId);
        const b = events.find((e) => e.id === c.bId);
        const aEnt = a ? entityById.get(a.entityId)?.name : "—";
        const bEnt = b ? entityById.get(b.entityId)?.name : "—";
        return [
          String(i + 1),
          c.label,
          a ? `${fmtWhen(a.timestamp)} · ${aEnt} · ${a.title}` : c.aId,
          b ? `${fmtWhen(b.timestamp)} · ${bEnt} · ${b.title}` : c.bId,
          c.detail,
          rec.workingNotes?.trim() || "Unresolved — investigator notes not recorded.",
        ];
      });
      autoTable(doc, {
        startY: y,
        margin: { left: 40, right: 40, top: 48, bottom: 44 },
        head: [["#", "Collision", "Event A", "Event B", "Finding", "Resolution notes"]],
        body,
        styles: { font: "helvetica", fontSize: 7.5, cellPadding: 4, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [180, 83, 9], textColor: 255, fontStyle: "bold" },
      });
      y = tableFinalY(doc, y);
    }
  }

  if (options.exhibits) {
    y = addSectionTitle(doc, "5. Source Exhibits Appendix", y);
    for (let i = 0; i < evidence.length; i += 1) {
      const ev = evidence[i];
      const pageH = doc.internal.pageSize.getHeight();
      if (y > pageH - 160) {
        doc.addPage();
        y = 56;
      }
      doc.setFont("courier", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(`${exhibitNumber(i)}  ·  ${ev.originalFileName || ev.fileName}`, 40, y);
      y += 14;
      doc.setFont("courier", "normal");
      doc.setFontSize(8);
      doc.text(`${sourceTypeLabel(ev)}  ·  ${ev.ingestedAt ? fmtWhen(Date.parse(ev.ingestedAt)) : "Date added unknown"}`, 40, y);
      y += 16;
      const img = !options.redact && (ev.thumbnailDataUrl || ev.imageBase64);
      if (options.redact && (ev.imageBase64 || ev.thumbnailDataUrl)) {
        doc.setFillColor(15, 23, 42);
        doc.roundedRect(40, y, 220, 90, 4, 4, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("VISUAL REDACTION APPLIED", 52, y + 48);
        doc.setTextColor(15, 23, 42);
        y += 104;
      } else if (img) {
        try {
          const fmt = img.includes("image/png") ? "PNG" : "JPEG";
          doc.addImage(img, fmt, 40, y, 220, 140, undefined, "FAST");
          y += 152;
        } catch {
          y += 8;
        }
      }
      const quote = redactText((ev.rawText || "").replace(/\s+/g, " ").trim().slice(0, 720), options.redact);
      if (quote) {
        doc.setFont("times", "italic");
        doc.setFontSize(9);
        const lines = doc.splitTextToSize(`“${quote}${ev.rawText.length > 720 ? "…" : ""}”`, pageW - 80);
        if (y + lines.length * 12 > pageH - 48) {
          doc.addPage();
          y = 56;
        }
        doc.text(lines, 40, y);
        y += lines.length * 12 + 18;
      } else {
        y += 12;
      }
    }
  }

  applyFooters(doc, rec.id);
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function buildSignedJsonArchive(
  payload: DossierExportPayload,
  options: DossierExportOptions,
): Promise<Uint8Array> {
  const exportAt = new Date().toISOString();
  const conflicts = detectTimelineConflicts(payload.events, payload.entities);
  const evidence = payload.evidence.map((ev, i) => ({
    exhibitNumber: exhibitNumber(i),
    id: ev.id,
    originalFileName: ev.originalFileName || ev.fileName,
    sourceType: inferSourceType(ev),
    mimeType: mimeOf(ev),
    byteSize: sizeOf(ev),
    ingestedAt: ev.ingestedAt,
    status: ev.status,
    rawText: options.redact ? redactText(ev.rawText || "", true) : ev.rawText,
    binaryOmitted: true,
  }));
  const archive = {
    format: "intellidex.signed-json-archive.v1",
    classification: CLASSIFICATION,
    exportedAt: exportAt,
    redacted: options.redact,
    operator: {
      creatorName: operatorName(payload.operator),
      showTitle: payload.operator.showTitle,
      role: payload.operator.role,
    },
    attestation:
      "Sources in this archive were stored locally. Binary payloads are omitted.",
    case: payload.case,
    entities: payload.entities,
    evidence,
    events: payload.events,
    contradictions: conflicts,
    sections: {
      cover: options.cover,
      custody: options.custody,
      chronology: options.chronology,
      contradictions: options.contradictions,
      exhibits: options.exhibits,
    },
  };
  return new TextEncoder().encode(`${JSON.stringify(archive, null, 2)}\n`);
}

export async function generateAndDownloadDossier(
  payload: DossierExportPayload,
  options: DossierExportOptions,
) {
  const slug = safeExportSlug(payload.case.title);
  const day = exportDateStamp();
  const files: { name: string; bytes: Uint8Array }[] = [];

  if (options.format === "json") {
    const jsonName = `INTELLIDEX_backup_${day}.json`;
    files.push({ name: jsonName, bytes: await buildSignedJsonArchive(payload, options) });
  } else {
    const pdfName = `${slug}_Official_INTELLIDEX_${day}.pdf`;
    files.push({ name: pdfName, bytes: await buildOfficialDossierPdf(payload, options) });
  }

  for (const file of files) {
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    downloadBlob(new Blob([copy], {
      type: options.format === "json" ? "application/json" : "application/pdf",
    }), file.name);
  }
}
