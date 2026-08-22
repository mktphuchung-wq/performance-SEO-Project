"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, inputClass } from "@/components/ui";
import { StatCard } from "@/components/StatCard";
import { currentMonthInputValue, formatMonthLabel, normalizeMonth } from "@/lib/content-review/month";
import { taskQualityPct } from "@/lib/content-review/quality";
import type { ParsedTaskRow } from "@/lib/content-review/parse-paste";
import { formatContentScore, formatPercent } from "@/lib/format";
import type {
  ContentReviewBatch,
  ContentReviewCriterion,
  ContentReviewScore,
  ContentReviewTask,
} from "@/lib/repositories/content-review";

interface BatchResponse {
  batch: ContentReviewBatch;
  criteria: ContentReviewCriterion[];
  tasks: ContentReviewTask[];
  scores: ContentReviewScore[];
  history: ContentReviewBatch[];
}

const cellKey = (taskId: string, criteriaId: string) => `${taskId}|${criteriaId}`;

function cellsFromScores(scores: ContentReviewScore[]): Record<string, string> {
  return Object.fromEntries(scores.map((score) => [cellKey(score.task_id, score.criteria_id), String(score.score)]));
}

/** A cell is graded only if it holds a number the scale accepts; "" is not a 0. */
function parseCell(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10) return null;
  return value;
}

/**
 * A month picker emits a value on every keystroke, so "2026-08" is briefly
 * "0002-08" while it is being typed. Opening a month creates it, so anything
 * outside a plausible working range is ignored rather than written.
 */
function isReviewableMonth(value: string): boolean {
  const normalized = normalizeMonth(value);
  if (!normalized) return false;
  const year = Number(normalized.slice(0, 4));
  return year >= 2000 && year <= 2100;
}

function shortUrls(urls: string): string {
  const lines = urls.split(/\s+/).filter(Boolean);
  if (lines.length === 0) return "—";
  if (lines.length === 1) return lines[0];
  return `${lines[0]} +${lines.length - 1} more`;
}

/** A note is saved this long after the last keystroke, and immediately on blur. */
const NOTE_DEBOUNCE_MS = 600;

/**
 * Content KPI — the manual review screen.
 *
 * It grades work a human judged, so it deliberately looks nothing like the
 * Official KPI pages: no range switcher, no Search Console anywhere. One member,
 * one calendar month, one grid.
 *
 * The columns of that grid belong to the member being reviewed: since migration
 * 008 each person has their own checklist, so switching member changes what the
 * work is measured against, not just whose work is listed.
 *
 * Every number in the totals panel comes back from the API after each write
 * rather than being recomputed in the browser, so what the reviewer reads is
 * what is actually stored — including the blanks. An ungraded cell, a month with
 * no target, a batch with no tasks: all of those show as "—", never as 0.
 */
export default function AdminContentReviewPage() {
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [member, setMember] = useState("");
  const [month, setMonth] = useState(currentMonthInputValue());

  const [data, setData] = useState<BatchResponse | null>(null);
  // Which (member, month) the loaded data belongs to. Loading is derived from
  // it rather than tracked separately, so switching member cannot leave the
  // previous month rendered under the new name.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [minPostDraft, setMinPostDraft] = useState("");
  const [cells, setCells] = useState<Record<string, string>>({});
  const [committed, setCommitted] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Record<string, boolean>>({});

  const [notes, setNotes] = useState<Record<string, string>>({});
  // What the server holds, kept in a ref rather than state: it is only ever read
  // by a save that fires long after the keystroke that scheduled it, and a stale
  // render copy there would re-send a note that was already stored.
  const committedNotes = useRef<Record<string, string>>({});
  // One pending timer per task, so typing in two notes cannot make the second
  // one cancel the first one's save.
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<{ rows: ParsedTaskRow[]; warnings: string[] } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/content-review/members")
      .then((r) => r.json())
      .then((res: { memberNames?: string[] }) => {
        const names = res.memberNames ?? [];
        setMemberNames(names);
        setMember((current) => current || names[0] || "");
      })
      .catch(() => setMemberNames([]));
  }, []);

  const applyBatch = useCallback((next: BatchResponse) => {
    setData(next);
    setMinPostDraft(String(next.batch.min_post));
    const fromServer = cellsFromScores(next.scores);
    setCells(fromServer);
    setCommitted(fromServer);
    const storedNotes = Object.fromEntries(next.tasks.map((task) => [task.id, task.note ?? ""]));
    setNotes(storedNotes);
    committedNotes.current = storedNotes;
  }, []);

  const requestKey = `${member}|${month}`;

  const load = useCallback(() => {
    if (!member || !isReviewableMonth(month)) return;

    fetch(`/api/admin/content-review/batch?member=${encodeURIComponent(member)}&month=${encodeURIComponent(month)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load this month");
        return body as BatchResponse;
      })
      .then((body) => {
        applyBatch(body);
        setError(null);
        // A preview belongs to the month it was parsed against; keeping it after
        // a switch would offer to import someone else rows.
        setPreview(null);
      })
      .catch((err: Error) => {
        setData(null);
        setError(err.message);
      })
      .then(() => setLoadedKey(requestKey));
  }, [member, month, requestKey, applyBatch]);

  useEffect(load, [load]);

  // A pending note save belongs to the screen that scheduled it. Leaving the
  // page or switching member drops the timer rather than firing it against a
  // task the reviewer is no longer looking at — the blur that always precedes
  // either action has already written the note.
  useEffect(() => {
    const timers = noteTimers.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  const loading = Boolean(member) && isReviewableMonth(month) && loadedKey !== requestKey;
  const batch = loadedKey === requestKey ? data?.batch ?? null : null;

  const criteriaById = useMemo(
    () => new Map((data?.criteria ?? []).map((criterion) => [criterion.id, criterion])),
    [data],
  );

  /**
   * Columns are the active checklist plus any retired criterion this month was
   * already graded on — hiding one would quietly change what its score means.
   */
  const columns = useMemo(() => {
    const graded = new Set((data?.scores ?? []).map((score) => score.criteria_id));
    return (data?.criteria ?? []).filter((criterion) => criterion.is_active || graded.has(criterion.id));
  }, [data]);

  function rowQuality(taskId: string): number | null {
    const scores = new Map<string, number>();
    for (const criterion of columns) {
      const value = parseCell(cells[cellKey(taskId, criterion.id)]);
      if (value !== null) scores.set(criterion.id, value);
    }
    return taskQualityPct(scores, criteriaById);
  }

  async function patchBatch(body: Record<string, unknown>) {
    if (!batch) return;
    const res = await fetch(`/api/admin/content-review/batch/${batch.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.error ?? "Could not save");
      return;
    }
    setError(null);
    setData((current) => (current ? { ...current, batch: payload.batch } : current));
  }

  async function commitCell(taskId: string, criteriaId: string) {
    if (!batch) return;
    const key = cellKey(taskId, criteriaId);
    const raw = cells[key] ?? "";
    if (raw === (committed[key] ?? "")) return;

    const parsed = parseCell(raw);
    if (raw.trim() !== "" && parsed === null) {
      setError("A grade has to be a number between 0 and 10.");
      return;
    }

    setSavingCells((current) => ({ ...current, [key]: true }));
    try {
      const res = await fetch(`/api/admin/content-review/task/${taskId}/score`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ criteriaId, score: parsed }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save this grade");

      const stored = parsed === null ? "" : String(parsed);
      setCells((current) => ({ ...current, [key]: stored }));
      setCommitted((current) => ({ ...current, [key]: stored }));
      setData((current) => {
        if (!current) return current;
        const scores = current.scores.filter(
          (score) => !(score.task_id === taskId && score.criteria_id === criteriaId),
        );
        if (parsed !== null) {
          scores.push({ task_id: taskId, criteria_id: criteriaId, score: parsed, updated_at: "" });
        }
        return { ...current, batch: payload.batch, scores };
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingCells((current) => ({ ...current, [key]: false }));
    }
  }

  /**
   * Writes one task's note. Nothing recomputes: a note explains a grade, it is
   * not one, so no figure on this screen can move because of it.
   */
  async function saveNote(taskId: string, next: string) {
    clearTimeout(noteTimers.current[taskId]);
    if (next === (committedNotes.current[taskId] ?? "")) return;

    // Recorded before the request, not after: a second keystroke landing while
    // this one is in flight compares against what is being sent, so the two do
    // not race to write the same text twice.
    committedNotes.current[taskId] = next;

    try {
      const res = await fetch(`/api/admin/content-review/task/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: next }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save this note");

      setData((current) =>
        current
          ? { ...current, tasks: current.tasks.map((task) => (task.id === taskId ? payload.task : task)) }
          : current,
      );
      setError(null);
    } catch (err) {
      // The write did not land, so the note is not stored — forget the optimistic
      // record of it, or a retry would be skipped as a no-op.
      delete committedNotes.current[taskId];
      setError((err as Error).message);
    }
  }

  function changeNote(taskId: string, value: string) {
    setNotes((current) => ({ ...current, [taskId]: value }));
    clearTimeout(noteTimers.current[taskId]);
    noteTimers.current[taskId] = setTimeout(() => void saveNote(taskId, value), NOTE_DEBOUNCE_MS);
  }

  async function runPreview() {
    if (!batch) return;
    const res = await fetch(`/api/admin/content-review/batch/${batch.id}/paste`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: pasteText, dryRun: true }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.error ?? "Could not read the pasted text");
      return;
    }
    setError(null);
    setPreview({ rows: payload.rows ?? [], warnings: payload.warnings ?? [] });
  }

  async function confirmImport() {
    if (!batch) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/admin/content-review/batch/${batch.id}/paste`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not import");

      setPasteText("");
      setPreview(null);
      setError(null);
      const importedNotes = Object.fromEntries(
        (payload.tasks as ContentReviewTask[]).map((task) => [task.id, task.note ?? ""]),
      );
      setNotes(importedNotes);
      committedNotes.current = importedNotes;
      setData((current) =>
        current ? { ...current, batch: payload.batch, tasks: payload.tasks, scores: payload.scores } : current,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function removeTask(taskId: string) {
    if (!batch) return;
    // Any note still waiting on its debounce would be written to a row that no
    // longer exists.
    clearTimeout(noteTimers.current[taskId]);
    const res = await fetch(`/api/admin/content-review/task/${taskId}`, { method: "DELETE" });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.error ?? "Could not delete this task");
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            batch: payload.batch,
            tasks: current.tasks.filter((task) => task.id !== taskId),
            scores: current.scores.filter((score) => score.task_id !== taskId),
          }
        : current,
    );
  }

  const minPostDirty = batch !== null && minPostDraft !== String(batch.min_post);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Content KPI"
        description="Quality graded by hand against the checklist, plus how much of the monthly target was delivered. Independent of Official KPI — nothing here touches Search Console."
        action={
          <Link
            href="/admin/content-review/settings"
            className="rounded-lg border border-line-strong px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-neutral-soft"
          >
            Manage checklists
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Month under review"
          description="One member, one calendar month. Opening a month that has never been reviewed creates it empty."
        />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* A picker rather than a free-text field on purpose: opening a month
              creates it, so a half-typed name would leave an empty batch behind
              for a member who does not exist. */}
          <Field label="Member">
            <select value={member} onChange={(e) => setMember(e.target.value)} className={inputClass}>
              {memberNames.length === 0 && <option value="">No members found</option>}
              {memberNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-subtle">
              Names come from the Sheet, aliases, and months already reviewed. The grid below uses this member&apos;s own
              checklist.
            </span>
          </Field>

          <Field label="Month">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
          </Field>

          <Field label="Min post (monthly target)">
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={minPostDraft}
                disabled={!batch}
                onChange={(e) => setMinPostDraft(e.target.value)}
                className={inputClass}
              />
              <Button
                onClick={() => void patchBatch({ minPost: Number(minPostDraft) })}
                disabled={!batch || !minPostDirty}
              >
                Save
              </Button>
            </div>
            <span className="text-xs text-ink-subtle">0 means no target set — completion stays blank, not 0%</span>
          </Field>

          <Field label="Status">
            <div className="flex items-center gap-2">
              <Button
                variant={batch?.status === "final" ? "secondary" : "primary"}
                disabled={!batch}
                onClick={() => void patchBatch({ status: batch?.status === "final" ? "draft" : "final" })}
              >
                {batch?.status === "final" ? "Reopen as draft" : "Mark as final"}
              </Button>
              {batch && <Badge tone={batch.status === "final" ? "positive" : "neutral"}>
                {batch.status === "final" ? "Final" : "Draft"}
              </Badge>}
            </div>
            <span className="text-xs text-ink-subtle">A label for your own tracking — a final month stays editable</span>
          </Field>
        </div>
      </Card>

      {error && <p className="text-[13px] text-negative">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Content KPI"
          value={formatContentScore(batch?.content_score)}
          sub="0.8 × quality + 0.2 × completion"
        />
        <StatCard
          label="Average quality"
          value={formatPercent(batch?.avg_quality_pct)}
          sub={batch ? "Ungraded cells are left out, not counted as 0" : undefined}
        />
        <StatCard
          label="Tasks"
          value={batch ? String(batch.task_count) : "—"}
          sub={batch && batch.min_post > 0 ? `of ${batch.min_post} target` : "No target set"}
        />
        <StatCard label="Completion" value={formatPercent(batch?.completion_pct)} sub="Capped at 100%" />
      </div>

      <Card>
        <CardHeader
          title="Paste from the Sheet"
          description="Select the data cells only — Ngày | Dự án - Web | Type | Task | URLs — and paste. Nothing is stored until you have looked at the preview."
        />
        <div className="space-y-3 px-5 py-4">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            disabled={!batch}
            placeholder="05/08/2026&#9;Project A&#9;Blog&#9;Top 10 running shoes&#9;https://…"
            className={`${inputClass} font-mono text-[13px]`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => void runPreview()} disabled={!batch || !pasteText.trim()}>
              Preview
            </Button>
            {preview && (
              <>
                <Button onClick={() => void confirmImport()} disabled={importing || preview.rows.length === 0}>
                  {importing ? "Adding…" : `Add ${preview.rows.length} tasks`}
                </Button>
                <Button variant="secondary" onClick={() => setPreview(null)} disabled={importing}>
                  Cancel
                </Button>
              </>
            )}
          </div>

          {preview?.warnings.map((warning) => (
            <p key={warning} className="text-[13px] text-warning">
              {warning}
            </p>
          ))}

          {preview && preview.rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-neutral-soft text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">URLs</th>
                    <th className="px-3 py-2 font-medium">Columns</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.map((row) => (
                    <tr key={row.sourceRowNumber}>
                      <td className="px-3 py-2 numeric">
                        {row.workedAt ?? <span className="text-warning">{row.workedAtRaw || "—"}</span>}
                      </td>
                      <td className="px-3 py-2">{row.project || "—"}</td>
                      <td className="px-3 py-2">{row.workType || "—"}</td>
                      <td className="px-3 py-2">{row.taskTitle || "—"}</td>
                      <td className="max-w-[240px] truncate px-3 py-2 text-ink-muted" title={row.urls}>
                        {shortUrls(row.urls)}
                      </td>
                      <td className={`px-3 py-2 numeric ${row.columnCount === 5 ? "text-ink-subtle" : "text-warning"}`}>
                        {row.columnCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Review grid${batch ? ` — ${formatMonthLabel(batch.month)}` : ""}`}
          description="Each cell is 0–10, graded against this member's own checklist. Leave a cell empty while you have not judged it: empty is dropped from the average, 0 says the work failed that criterion. The note is yours — it never affects a score."
        />

        {loading && <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>}

        {!loading && batch && columns.length === 0 && (
          <EmptyState
            title={`${member} has no checklist yet`}
            hint="Open Manage checklists to add criteria, or copy another member's list — there is nothing to grade against until then."
          />
        )}

        {!loading && batch && columns.length > 0 && data && data.tasks.length === 0 && (
          <EmptyState title="No tasks in this month yet" hint="Paste the member rows from the Sheet above." />
        )}

        {!loading && batch && columns.length > 0 && data && data.tasks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  {columns.map((criterion) => (
                    <th key={criterion.id} className="px-2 py-2.5 text-center font-medium" title={`Weight ${criterion.weight}`}>
                      <span className={criterion.is_active ? "" : "text-warning"}>{criterion.name}</span>
                      {Number(criterion.weight) !== 1 && (
                        <span className="ml-1 text-ink-subtle numeric">×{criterion.weight}</span>
                      )}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium">Quality</th>
                  <th className="px-4 py-2.5 font-medium">Note</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.tasks.map((task) => (
                  <tr key={task.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2 numeric text-ink-muted">{task.worked_at ?? "—"}</td>
                    <td className="min-w-[220px] max-w-[320px] px-4 py-2">
                      <div className="truncate text-ink" title={task.task_title}>
                        {task.task_title || "—"}
                      </div>
                      <div className="truncate text-[12px] text-ink-subtle" title={`${task.project} · ${task.work_type}`}>
                        {[task.project, task.work_type].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <div className="truncate text-[12px] text-ink-subtle" title={task.urls}>
                        {shortUrls(task.urls)}
                      </div>
                    </td>

                    {columns.map((criterion) => {
                      const key = cellKey(task.id, criterion.id);
                      const raw = cells[key] ?? "";
                      const invalid = raw.trim() !== "" && parseCell(raw) === null;
                      return (
                        <td key={criterion.id} className="px-2 py-2 text-center">
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.5"
                            value={raw}
                            onChange={(e) => setCells((current) => ({ ...current, [key]: e.target.value }))}
                            onBlur={() => void commitCell(task.id, criterion.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            aria-label={`${criterion.name} for ${task.task_title || "task"}`}
                            className={`w-16 rounded-lg border px-2 py-1.5 text-center text-sm numeric focus:outline-none focus:ring-2 focus:ring-accent/25 ${
                              invalid ? "border-negative text-negative" : "border-line-strong text-ink"
                            } ${savingCells[key] ? "opacity-60" : ""}`}
                          />
                        </td>
                      );
                    })}

                    <td className="whitespace-nowrap px-4 py-2 text-right numeric text-ink">
                      {formatPercent(rowQuality(task.id))}
                    </td>
                    <td className="px-4 py-2">
                      {/* Free text, one per task rather than one per graded cell:
                          the reviewer is writing down what they thought of the
                          piece, and splitting that across the checklist columns
                          would make them say it several times. */}
                      <textarea
                        value={notes[task.id] ?? ""}
                        onChange={(e) => changeNote(task.id, e.target.value)}
                        onBlur={() => void saveNote(task.id, notes[task.id] ?? "")}
                        rows={2}
                        placeholder="Why this grade…"
                        aria-label={`Note for ${task.task_title || "task"}`}
                        className={`${inputClass} min-w-[180px] resize-y text-[13px]`}
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="danger" onClick={() => void removeTask(task.id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && data && data.history.length > 0 && (
        <Card>
          <CardHeader title={`${member} — every reviewed month`} description="What the member sees on their own dashboard." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Month</th>
                  <th className="px-4 py-2.5 text-right font-medium">Content KPI</th>
                  <th className="px-4 py-2.5 text-right font-medium">Quality</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tasks / target</th>
                  <th className="px-4 py-2.5 text-right font-medium">Completion</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.history.map((row) => (
                  <tr key={row.id} className={row.id === batch?.id ? "bg-accent-soft/40" : ""}>
                    <td className="px-4 py-2">{formatMonthLabel(row.month)}</td>
                    <td className="px-4 py-2 text-right numeric">{formatContentScore(row.content_score)}</td>
                    <td className="px-4 py-2 text-right numeric">{formatPercent(row.avg_quality_pct)}</td>
                    <td className="px-4 py-2 text-right numeric">
                      {row.task_count} / {row.min_post > 0 ? row.min_post : "—"}
                    </td>
                    <td className="px-4 py-2 text-right numeric">{formatPercent(row.completion_pct)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={row.status === "final" ? "positive" : "neutral"}>
                        {row.status === "final" ? "Final" : "Draft"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
