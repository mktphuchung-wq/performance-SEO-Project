import type { AuditConclusion } from "@/lib/performance/audit-workflow";

/**
 * The evidence package an external-cause conclusion has to carry.
 *
 * A structured shape rather than a free-text box because the whole point is that
 * the same questions get answered every time. "Traffic dropped when the core
 * update landed" is a coincidence, not a finding — a core update can move a whole
 * market, and it can equally expose a content problem that was always ours. The
 * fields below are what separates those two readings, and they are the reason
 * every one of them is required before a conclusion can reduce accountability.
 */
export interface AuditEvidence {
  declining_dimensions: string;
  cohort_evidence: string;
  technical_check: string;
  index_check: string;
  content_check: string;
  cannibalization_check: string;
  serp_evidence: string;
}

export interface EvidenceField {
  key: keyof AuditEvidence;
  label: string;
  hint: string;
}

export const EVIDENCE_FIELDS: EvidenceField[] = [
  {
    key: "declining_dimensions",
    label: "What declined",
    hint: "Which queries, pages, devices and countries lost the traffic.",
  },
  {
    key: "cohort_evidence",
    label: "Cohort / comparison",
    hint: "Evidence the trend is not confined to this URL or this site — comparable pages, competitors, category demand.",
  },
  {
    key: "technical_check",
    label: "Technical check",
    hint: "Crawlability, response codes, speed, redirects, structured data.",
  },
  {
    key: "index_check",
    label: "Index check",
    hint: "Indexing status and coverage over the affected period.",
  },
  {
    key: "content_check",
    label: "Content check",
    hint: "Freshness, intent match, depth against what now ranks.",
  },
  {
    key: "cannibalization_check",
    label: "Cannibalization check",
    hint: "Other pages of ours competing for the same queries.",
  },
  {
    key: "serp_evidence",
    label: "SERP evidence",
    hint: "Snapshot, report or source that corroborates the external cause.",
  },
];

/** The conclusions that reduce accountability, and so must be argued for. */
const REQUIRES_EVIDENCE: AuditConclusion[] = ["external_verified", "mixed"];

export function emptyEvidence(): AuditEvidence {
  return {
    declining_dimensions: "",
    cohort_evidence: "",
    technical_check: "",
    index_check: "",
    content_check: "",
    cannibalization_check: "",
    serp_evidence: "",
  };
}

/**
 * Coerce whatever arrived into the evidence shape, keeping only the known keys.
 * Returns null when nothing was filled in at all, so an empty package is stored
 * as SQL null and the database's own "evidence is not null" check still means
 * what it says.
 */
export function normalizeEvidence(input: unknown): AuditEvidence | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out = emptyEvidence();
  let filled = false;
  for (const field of EVIDENCE_FIELDS) {
    const raw = source[field.key];
    if (typeof raw === "string" && raw.trim()) {
      out[field.key] = raw.trim();
      filled = true;
    }
  }
  return filled ? out : null;
}

/**
 * Which required answers are still blank. Every field, not a subset: an external
 * cause is only demonstrated by ruling the internal ones out, so a package that
 * skips the cannibalization check has not ruled it out — it has ignored it.
 */
export function missingEvidenceFields(
  evidence: AuditEvidence | null,
  conclusion: AuditConclusion | null,
): EvidenceField[] {
  if (conclusion === null || !REQUIRES_EVIDENCE.includes(conclusion)) return [];
  if (evidence === null) return EVIDENCE_FIELDS;
  return EVIDENCE_FIELDS.filter((field) => !evidence[field.key]?.trim());
}

export function conclusionRequiresEvidence(conclusion: AuditConclusion | null): boolean {
  return conclusion !== null && REQUIRES_EVIDENCE.includes(conclusion);
}
