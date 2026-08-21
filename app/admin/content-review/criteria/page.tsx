"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, inputClass } from "@/components/ui";
import type { ContentReviewCriterion } from "@/lib/repositories/content-review";

interface DraftRow {
  name: string;
  weight: string;
}

/**
 * The checklist a reviewer grades against.
 *
 * It lives in the database rather than in code because it is a judgement about
 * what good content is, and that changes — the same reason kpi_settings is a
 * table. Weight is what makes a criterion count for more than another; leaving
 * every weight at 1 gives the plain average most teams want.
 *
 * Retiring beats deleting: a criterion that has already graded something is kept
 * and deactivated, so past months still show what they were judged on. Deleting
 * it for real takes those grades with it, which is why that path asks twice.
 */
export default function ContentReviewCriteriaPage() {
  // null means "not fetched yet", which is what the loading state is derived
  // from — an empty checklist and an unloaded one are different screens.
  const [criteriaData, setCriteriaData] = useState<ContentReviewCriterion[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("1");
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  const load = useCallback(() => {
    fetch("/api/admin/content-review/criteria")
      .then((r) => r.json())
      .then((res: { criteria?: ContentReviewCriterion[] }) => {
        const rows = res.criteria ?? [];
        setCriteriaData(rows);
        setDrafts(
          Object.fromEntries(rows.map((row) => [row.id, { name: row.name, weight: String(row.weight) }])),
        );
      })
      .catch(() => setCriteriaData([]));
  }, []);

  useEffect(load, [load]);

  const criteria = criteriaData ?? [];
  const loading = criteriaData === null;

  function report(text: string, isError = false) {
    setMessage(text);
    setFailed(isError);
  }

  async function addCriterion() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/content-review/criteria", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), weight: newWeight }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not add this criterion");
      setNewName("");
      setNewWeight("1");
      report(`Added "${payload.criterion.name}".`);
      load();
    } catch (error) {
      report((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, okMessage: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/content-review/criteria/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save");
      const recomputed = payload.recomputedBatches
        ? ` ${payload.recomputedBatches} reviewed months were rescored.`
        : "";
      report(okMessage + recomputed);
      load();
    } catch (error) {
      report((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  /**
   * First attempt never forces. The API answers with how many grades would be
   * destroyed, and only then is the second, explicit confirmation offered.
   */
  async function removeCriterion(row: ContentReviewCriterion) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/content-review/criteria/${row.id}`, { method: "DELETE" });
      const payload = await res.json();

      if (res.status === 409 && payload.canForce) {
        const confirmed = window.confirm(
          `${payload.error}\n\nDelete "${row.name}" anyway? ${payload.scoreCount} grades in past months will be erased and those months rescored. This cannot be undone.`,
        );
        if (!confirmed) {
          report("Nothing was deleted.");
          return;
        }
        const forced = await fetch(`/api/admin/content-review/criteria/${row.id}?force=true`, { method: "DELETE" });
        const forcedPayload = await forced.json();
        if (!forced.ok) throw new Error(forcedPayload.error ?? "Could not delete");
        report(`Deleted "${row.name}" and ${forcedPayload.deletedScoreCount} grades.`);
        load();
        return;
      }

      if (!res.ok) throw new Error(payload.error ?? "Could not delete");
      report(`Deleted "${row.name}".`);
      load();
    } catch (error) {
      report((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  /** Swapping the two sort_order values leaves the rest of the list untouched. */
  async function move(row: ContentReviewCriterion, direction: -1 | 1) {
    const index = criteria.findIndex((item) => item.id === row.id);
    const swapWith = criteria[index + direction];
    if (!swapWith) return;

    setSaving(true);
    try {
      for (const [id, sortOrder] of [
        [row.id, swapWith.sort_order],
        [swapWith.id, row.sort_order],
      ] as const) {
        const res = await fetch(`/api/admin/content-review/criteria/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sortOrder }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not reorder");
      }
      report("Order updated.");
      load();
    } catch (error) {
      report((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = criteria.filter((row) => row.is_active).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-6">
      <PageHeader
        title="Content KPI — checklist"
        description="The criteria every task is graded against, and how much each one counts."
        action={
          <Link
            href="/admin/content-review"
            className="rounded-lg border border-line-strong px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-neutral-soft"
          >
            Back to review
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Add a criterion"
          description="Weight 1 means it counts the same as every other criterion — leave it at 1 unless one thing genuinely matters more."
        />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <Field label="Name">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Search intent match"
              className={inputClass}
            />
          </Field>
          <Field label="Weight">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Button onClick={() => void addCriterion()} disabled={saving || !newName.trim()}>
            Add
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Checklist"
          description={`${activeCount} active of ${criteria.length}. Each is graded 0–10 per task; the task score is their weighted average.`}
        />

        {loading && <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>}

        {!loading && criteria.length === 0 && (
          <EmptyState
            title="No criteria yet"
            hint="Add the first one above — the review grid has nothing to grade against until then."
          />
        )}

        {!loading && criteria.length > 0 && (
          <ul className="divide-y divide-line">
            {criteria.map((row, index) => {
              const draft = drafts[row.id] ?? { name: row.name, weight: String(row.weight) };
              const dirty = draft.name !== row.name || draft.weight !== String(row.weight);

              return (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${row.name} up`}
                      disabled={index === 0 || saving}
                      onClick={() => void move(row, -1)}
                      className="rounded px-1.5 text-xs text-ink-subtle hover:bg-neutral-soft disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${row.name} down`}
                      disabled={index === criteria.length - 1 || saving}
                      onClick={() => void move(row, 1)}
                      className="rounded px-1.5 text-xs text-ink-subtle hover:bg-neutral-soft disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>

                  <input
                    value={draft.name}
                    onChange={(e) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, name: e.target.value } }))}
                    className={`${inputClass} min-w-[200px] flex-1`}
                  />
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    aria-label={`Weight for ${row.name}`}
                    value={draft.weight}
                    onChange={(e) =>
                      setDrafts((current) => ({ ...current, [row.id]: { ...draft, weight: e.target.value } }))
                    }
                    className={`${inputClass} w-24`}
                  />

                  {!row.is_active && <Badge tone="warning">Retired</Badge>}

                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() =>
                        void patch(
                          row.id,
                          { name: draft.name.trim(), weight: Number(draft.weight) },
                          `Saved "${draft.name.trim()}".`,
                        )
                      }
                      disabled={saving || !dirty || !draft.name.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void patch(
                          row.id,
                          { isActive: !row.is_active },
                          row.is_active
                            ? `"${row.name}" retired — hidden from new reviews, past grades kept.`
                            : `"${row.name}" is back in the checklist.`,
                        )
                      }
                      disabled={saving}
                    >
                      {row.is_active ? "Retire" : "Restore"}
                    </Button>
                    <Button variant="danger" onClick={() => void removeCriterion(row)} disabled={saving}>
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {message && <p className={`px-5 pb-4 text-[13px] ${failed ? "text-negative" : "text-ink-muted"}`}>{message}</p>}
      </Card>
    </div>
  );
}
