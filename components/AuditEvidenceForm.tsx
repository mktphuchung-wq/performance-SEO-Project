"use client";

import { EVIDENCE_FIELDS, type AuditEvidence } from "@/lib/performance/audit-evidence";
import { AUDIT_CONCLUSION_HINTS, AUDIT_CONCLUSION_LABELS } from "@/lib/format";
import { AUDIT_CONCLUSIONS, type AuditConclusion } from "@/lib/performance/audit-workflow";
import { inputClass } from "@/components/ui";

/**
 * The evidence package and the conclusion it supports.
 *
 * The conclusion is four buttons, not a number field: external share is derived
 * from the choice and only ever takes one of three values. Letting someone type
 * 0.37 would put a second decimal place on a judgement that does not have one.
 */
export function AuditEvidenceForm({
  evidence,
  conclusion,
  confidenceNote,
  causeStartDate,
  causeEndDate,
  missingKeys,
  disabled,
  onEvidenceChange,
  onConclusionChange,
  onConfidenceNoteChange,
  onCauseChange,
}: {
  evidence: AuditEvidence;
  conclusion: AuditConclusion | null;
  confidenceNote: string;
  causeStartDate: string;
  causeEndDate: string;
  missingKeys: Set<string>;
  disabled?: boolean;
  onEvidenceChange: (key: keyof AuditEvidence, value: string) => void;
  onConclusionChange: (value: AuditConclusion | null) => void;
  onConfidenceNoteChange: (value: string) => void;
  onCauseChange: (which: "start" | "end", value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-ink-muted">Conclusion</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {AUDIT_CONCLUSIONS.map((option) => {
            const active = conclusion === option;
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => onConclusionChange(active ? null : option)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  disabled
                    ? "cursor-not-allowed border-line bg-neutral-soft text-ink-muted opacity-70"
                    : active
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-line-strong bg-surface text-ink hover:bg-neutral-soft"
                }`}
              >
                <span className="font-medium">{AUDIT_CONCLUSION_LABELS[option]}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-ink-muted">
                  {AUDIT_CONCLUSION_HINTS[option]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-ink-subtle">
          Recording a conclusion does not change anyone&rsquo;s KPI. Observed KPI stays the official number.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[160px] flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">Cause window starts</span>
          <input
            type="date"
            value={causeStartDate}
            disabled={disabled}
            onChange={(e) => onCauseChange("start", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">Cause window ends</span>
          <input
            type="date"
            value={causeEndDate}
            disabled={disabled}
            onChange={(e) => onCauseChange("end", e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-3">
        {EVIDENCE_FIELDS.map((field) => {
          const missing = missingKeys.has(field.key);
          return (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">
                {field.label}
                {missing && <span className="ml-1.5 text-negative">required</span>}
              </span>
              <span className="text-[13px] leading-5 text-ink-subtle">{field.hint}</span>
              <textarea
                rows={2}
                value={evidence[field.key]}
                disabled={disabled}
                onChange={(e) => onEvidenceChange(field.key, e.target.value)}
                className={`${inputClass} ${missing ? "border-negative" : ""}`}
              />
            </label>
          );
        })}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Confidence note</span>
        <span className="text-[13px] leading-5 text-ink-subtle">
          How sure you are, and what would change your mind.
        </span>
        <textarea
          rows={2}
          value={confidenceNote}
          disabled={disabled}
          onChange={(e) => onConfidenceNoteChange(e.target.value)}
          className={inputClass}
        />
      </label>
    </div>
  );
}
