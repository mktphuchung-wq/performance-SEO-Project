"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { KPI_STRATEGY_HINTS, KPI_STRATEGY_LABELS } from "@/lib/format";
import {
  KPI_STRATEGY_PRESETS,
  weightPct,
  type KpiPeriodWeights,
  type KpiStrategy,
} from "@/lib/performance/composite-score";
import type { MemberKpiWeightsRow } from "@/lib/repositories/member-kpi-weights";

interface WeightsResponse {
  defaultWeights: KpiPeriodWeights;
  trendTolerance: number;
  profiles: MemberKpiWeightsRow[];
  memberNames: string[];
}

/** The form works in whole percents; the API stores fractions that sum to 1. */
interface MixDraft {
  w1: string;
  w3: string;
  w6: string;
}

const PRESET_ORDER: Array<Exclude<KpiStrategy, "custom">> = ["balanced", "momentum", "sustainability"];

function draftFrom(weights: KpiPeriodWeights): MixDraft {
  return {
    w1: String(weightPct(weights.last_1_month)),
    w3: String(weightPct(weights.last_3_months)),
    w6: String(weightPct(weights.last_6_months)),
  };
}

function draftSum(draft: MixDraft): number {
  return Number(draft.w1 || 0) + Number(draft.w3 || 0) + Number(draft.w6 || 0);
}

/** Which preset the typed numbers currently match, so the chip lights up again. */
function strategyOfDraft(draft: MixDraft): KpiStrategy {
  const match = PRESET_ORDER.find(
    (strategy) =>
      weightPct(KPI_STRATEGY_PRESETS[strategy].last_1_month) === Number(draft.w1) &&
      weightPct(KPI_STRATEGY_PRESETS[strategy].last_3_months) === Number(draft.w3) &&
      weightPct(KPI_STRATEGY_PRESETS[strategy].last_6_months) === Number(draft.w6),
  );
  return match ?? "custom";
}

function MixFields({
  draft,
  onChange,
  disabled,
}: {
  draft: MixDraft;
  onChange: (next: MixDraft) => void;
  disabled?: boolean;
}) {
  const fields: Array<{ key: keyof MixDraft; label: string; hint: string }> = [
    { key: "w1", label: "1M weight (%)", hint: "Momentum — recent movement" },
    { key: "w3", label: "3M weight (%)", hint: "Core performance" },
    { key: "w6", label: "6M weight (%)", hint: "Sustainability" },
  ];

  return (
    <>
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          <input
            type="number"
            min="0"
            max="100"
            step="5"
            value={draft[field.key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, [field.key]: e.target.value })}
            className={inputClass}
          />
          <span className="text-xs text-ink-subtle">{field.hint}</span>
        </Field>
      ))}
    </>
  );
}

function PresetButtons({
  active,
  onPick,
}: {
  active: KpiStrategy;
  onPick: (strategy: KpiStrategy, weights: KpiPeriodWeights) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_ORDER.map((strategy) => (
        <button
          key={strategy}
          type="button"
          title={KPI_STRATEGY_HINTS[strategy]}
          onClick={() => onPick(strategy, KPI_STRATEGY_PRESETS[strategy])}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            active === strategy
              ? "border-accent bg-accent text-white"
              : "border-line-strong bg-surface text-ink-muted hover:bg-neutral-soft hover:text-ink"
          }`}
        >
          {KPI_STRATEGY_LABELS[strategy]}
          <span className={`ml-1.5 text-xs ${active === strategy ? "text-white/80" : "text-ink-subtle"}`}>
            {weightPct(KPI_STRATEGY_PRESETS[strategy].last_1_month)}/
            {weightPct(KPI_STRATEGY_PRESETS[strategy].last_3_months)}/
            {weightPct(KPI_STRATEGY_PRESETS[strategy].last_6_months)}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Admin control for Layer 3: the team's default period mix, and a personal
 * strategy per member.
 *
 * A personal strategy changes which months a member is judged on, never how
 * generously — every mix still sums to 100%, so one Official KPI stays
 * comparable with another. What it buys is honesty about the job: someone
 * turning a site around is measured on momentum, someone holding an established
 * site on sustainability, and neither has to be graded by the other's yardstick.
 *
 * Only the weights are configurable. Which three periods exist, and the rule
 * that a missing one is renormalized instead of zeroed, stay fixed — those are
 * what make the numbers comparable in the first place.
 */
export function KpiWeightsPanel() {
  const [data, setData] = useState<WeightsResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [defaultDraft, setDefaultDraft] = useState<MixDraft>({ w1: "25", w3: "50", w6: "25" });
  const [tolerance, setTolerance] = useState("5");

  const [memberName, setMemberName] = useState("");
  const [memberDraft, setMemberDraft] = useState<MixDraft>({ w1: "25", w3: "50", w6: "25" });
  const [memberNote, setMemberNote] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/kpi-weights")
      .then((r) => r.json())
      .then((body: WeightsResponse) => {
        setData(body);
        setDefaultDraft(draftFrom(body.defaultWeights));
        setTolerance(String(body.trendTolerance));
      })
      .catch(() => setData(null));
  }, []);

  useEffect(load, [load]);

  const defaultSum = draftSum(defaultDraft);
  const memberSum = draftSum(memberDraft);

  const profileByName = useMemo(
    () => new Map((data?.profiles ?? []).map((row) => [row.member_name, row])),
    [data],
  );

  function editProfile(row: MemberKpiWeightsRow) {
    setMemberName(row.member_name);
    setMemberDraft(
      draftFrom({
        last_1_month: Number(row.weight_1m),
        last_3_months: Number(row.weight_3m),
        last_6_months: Number(row.weight_6m),
      }),
    );
    setMemberNote(row.note ?? "");
  }

  async function post(body: Record<string, unknown>, okMessage: string) {
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const res = await fetch("/api/admin/kpi-weights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save");
      setMessage(okMessage);
      load();
    } catch (error) {
      setFailed(true);
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function saveDefault() {
    void post(
      {
        strategy: "custom",
        weight1m: Number(defaultDraft.w1),
        weight3m: Number(defaultDraft.w3),
        weight6m: Number(defaultDraft.w6),
        trendTolerance: Number(tolerance),
      },
      "Team default saved. It applies immediately — Official KPI is derived, so nothing needs recomputing.",
    );
  }

  function saveMember() {
    if (!memberName.trim()) return;
    void post(
      {
        memberName: memberName.trim(),
        strategy: strategyOfDraft(memberDraft),
        weight1m: Number(memberDraft.w1),
        weight3m: Number(memberDraft.w3),
        weight6m: Number(memberDraft.w6),
        note: memberNote,
      },
      `Strategy saved for ${memberName.trim()}.`,
    );
  }

  async function removeProfile(name: string) {
    await fetch(`/api/admin/kpi-weights?memberName=${encodeURIComponent(name)}`, { method: "DELETE" });
    setMessage(`${name} is back on the team default.`);
    setFailed(false);
    load();
  }

  return (
    <Card>
      <CardHeader
        title="Official KPI — period weights"
        description="Official KPI = 1M × w1 + 3M × w3 + 6M × w6. Weights always add up to 100%, so every member stays on the same 0–100 scale — a personal strategy changes which months count, not how easy the score is."
      />

      <div className="space-y-6 px-5 py-4">
        {!data && <p className="text-[13px] text-ink-subtle">Loading weights…</p>}

        {data && (
          <>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-ink">Team default</h3>
                <PresetButtons
                  active={strategyOfDraft(defaultDraft)}
                  onPick={(_, weights) => setDefaultDraft(draftFrom(weights))}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MixFields draft={defaultDraft} onChange={setDefaultDraft} />
                <Field label="Trend tolerance (points)">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="1"
                    value={tolerance}
                    onChange={(e) => setTolerance(e.target.value)}
                    className={inputClass}
                  />
                  <span className="text-xs text-ink-subtle">
                    Below this gap two periods read as equal — diagnostic only, never touches the KPI
                  </span>
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={saveDefault} disabled={saving || !(defaultSum > 0)}>
                  {saving ? "Saving…" : "Save team default"}
                </Button>
                <Button variant="secondary" onClick={load} disabled={saving}>
                  Reset
                </Button>
                <span className={`text-[13px] ${Math.abs(defaultSum - 100) < 0.001 ? "text-ink-subtle" : "text-warning"}`}>
                  Total {defaultSum}%
                  {Math.abs(defaultSum - 100) < 0.001 ? "" : " — will be rescaled to 100% on save"}
                </span>
              </div>
            </section>

            <section className="space-y-3 border-t border-line pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-ink">
                  Personal strategy
                  <span className="ml-2 font-normal text-ink-subtle">
                    overrides the team default for one member
                  </span>
                </h3>
                <PresetButtons
                  active={strategyOfDraft(memberDraft)}
                  onPick={(_, weights) => setMemberDraft(draftFrom(weights))}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Member">
                  <input
                    list="kpi-weight-member-names"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="Name as written in the Sheet"
                    className={inputClass}
                  />
                  <datalist id="kpi-weight-member-names">
                    {data.memberNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </Field>
                <MixFields draft={memberDraft} onChange={setMemberDraft} />
              </div>

              <Field label="Why (optional)">
                <input
                  value={memberNote}
                  onChange={(e) => setMemberNote(e.target.value)}
                  placeholder="e.g. Turnaround on Project X — judged on momentum until Q4"
                  className={inputClass}
                />
              </Field>

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={saveMember} disabled={saving || !memberName.trim() || !(memberSum > 0)}>
                  {saving ? "Saving…" : profileByName.has(memberName.trim()) ? "Update strategy" : "Save strategy"}
                </Button>
                <span className={`text-[13px] ${Math.abs(memberSum - 100) < 0.001 ? "text-ink-subtle" : "text-warning"}`}>
                  Total {memberSum}%
                  {Math.abs(memberSum - 100) < 0.001 ? "" : " — will be rescaled to 100% on save"}
                </span>
              </div>

              <ul className="divide-y divide-line rounded-lg border border-line">
                {data.profiles.length === 0 && (
                  <li className="px-3 py-3 text-[13px] text-ink-subtle">
                    No personal strategy set — every member is graded on the team default.
                  </li>
                )}
                {data.profiles.map((row) => (
                  <li key={row.member_name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <span className="min-w-0 text-sm text-ink">
                      <span className="font-medium">{row.member_name}</span>
                      <span className="mx-2 text-ink-subtle">→</span>
                      <span className="numeric">
                        {weightPct(row.weight_1m)}% 1M · {weightPct(row.weight_3m)}% 3M · {weightPct(row.weight_6m)}% 6M
                      </span>
                      {row.note && <span className="ml-2 text-[13px] text-ink-subtle">— {row.note}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone="accent">{KPI_STRATEGY_LABELS[row.strategy] ?? row.strategy}</Badge>
                      <Button variant="secondary" onClick={() => editProfile(row)}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => removeProfile(row.member_name)}>
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {message && <p className={`text-[13px] ${failed ? "text-negative" : "text-ink-muted"}`}>{message}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
