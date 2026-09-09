"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AuditRolesPanel } from "@/components/AuditRolesPanel";
import { KpiWeightsPanel } from "@/components/KpiWeightsPanel";
import { Badge, Button, Card, CardHeader, Field, PageHeader, inputClass } from "@/components/ui";
import { PROJECT_TYPE_LABELS } from "@/lib/format";

interface MemberAlias {
  member_name: string;
  member_email: string;
}

interface ProjectGscProperty {
  project: string;
  gsc_property: string;
  notes: string | null;
  project_type: string;
}

interface KpiSettingsRow {
  target_growth_pct_new: number;
  target_growth_pct_growth: number;
  target_growth_pct_stable: number;
  smoothing_constant: number;
  click_weight: number;
  impression_weight: number;
  url_weight_cap_pct: number;
  baseline_lookback_periods: number;
  baseline_winsorize_multiple: number;
  anomaly_zscore_threshold: number;
  anomaly_ratio_threshold: number;
  anomaly_min_history_months: number;
  warning_click_drop_pct: number;
  warning_min_click_loss: number;
  warning_url_score_ceiling: number;
  warning_drag_points_1m: number;
  warning_drag_points_3m: number;
  warning_consecutive_months: number;
  audit_sla_days: number;
  audit_exposure_escalation_pct: number;
}

const KPI_FIELDS: Array<{ key: keyof KpiSettingsRow; label: string; hint: string; step: string }> = [
  { key: "target_growth_pct_new", label: "Target growth · New (%)", hint: "Growth that earns a 100", step: "1" },
  { key: "target_growth_pct_growth", label: "Target growth · Growth (%)", hint: "Growth that earns a 100", step: "1" },
  {
    key: "target_growth_pct_stable",
    label: "Target growth · Stable (%)",
    hint: "Lower — less movement expected",
    step: "1",
  },
  {
    key: "smoothing_constant",
    label: "Smoothing constant",
    hint: "Damps the ratio at low baselines. Raise it if tiny URLs score wildly",
    step: "1",
  },
  { key: "click_weight", label: "Click weight", hint: "Must add up to 1 with impression weight", step: "0.05" },
  { key: "impression_weight", label: "Impression weight", hint: "Must add up to 1 with click weight", step: "0.05" },
  { key: "url_weight_cap_pct", label: "URL weight cap (%)", hint: "Max share one URL can take", step: "1" },
];

const BASELINE_FIELDS: Array<{ key: keyof KpiSettingsRow; label: string; hint: string; step: string }> = [
  {
    key: "baseline_lookback_periods",
    label: "Baseline periods",
    hint: "How many past periods the score is graded against. 1 = the single previous period, as before",
    step: "1",
  },
  {
    key: "baseline_winsorize_multiple",
    label: "Winsorize multiple",
    hint: "How far a single period may sit from the median before it is pulled in",
    step: "0.5",
  },
  {
    key: "anomaly_zscore_threshold",
    label: "Anomaly z-score",
    hint: "Deviations from a URL's own median before a month is flagged. Lower = more sensitive",
    step: "0.5",
  },
  {
    key: "anomaly_ratio_threshold",
    label: "Anomaly fold-change",
    hint: "A flagged month must also be this many times its median — keeps quiet URLs from tripping",
    step: "0.5",
  },
  {
    key: "anomaly_min_history_months",
    label: "Min history (months)",
    hint: "Months of history required before any month can be judged anomalous",
    step: "1",
  },
];

/**
 * When a URL is worth a human looking at it. Every one is a starting value for a
 * backtest rather than settled policy, which is exactly why they are settings and
 * not constants — the numbers that matter can only be chosen by measuring how
 * these ones behave.
 */
const WARNING_FIELDS: Array<{ key: keyof KpiSettingsRow; label: string; hint: string; step: string }> = [
  {
    key: "warning_click_drop_pct",
    label: "Click drop (%)",
    hint: "Minimum decline against the baseline",
    step: "1",
  },
  {
    key: "warning_min_click_loss",
    label: "Minimum clicks lost",
    hint: "Absolute floor, so a 3-to-1 URL does not warn",
    step: "1",
  },
  {
    key: "warning_url_score_ceiling",
    label: "URL score ceiling",
    hint: "Only URLs scoring below this can warn",
    step: "1",
  },
  {
    key: "warning_drag_points_1m",
    label: "KPI drag · 1M",
    hint: "Points it must cost the member to warn",
    step: "0.1",
  },
  {
    key: "warning_drag_points_3m",
    label: "KPI drag · 3M",
    hint: "Points it must cost to force an audit",
    step: "0.1",
  },
  {
    key: "warning_consecutive_months",
    label: "Consecutive months",
    hint: "Closed months in a row that escalate to an audit",
    step: "1",
  },
  { key: "audit_sla_days", label: "Audit SLA (days)", hint: "Measures the queue, never a score", step: "1" },
  {
    key: "audit_exposure_escalation_pct",
    label: "Escalation exposure (%)",
    hint: "Above this share, a case needs a lead",
    step: "1",
  },
];

const SETTINGS_FIELDS = [...KPI_FIELDS, ...BASELINE_FIELDS, ...WARNING_FIELDS];

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const [aliases, setAliases] = useState<MemberAlias[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [aliasName, setAliasName] = useState("");
  const [aliasEmail, setAliasEmail] = useState("");

  const [properties, setProperties] = useState<ProjectGscProperty[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [propProject, setPropProject] = useState("");
  const [propGscProperty, setPropGscProperty] = useState("");
  const [propProjectType, setPropProjectType] = useState("growth");
  const [propertyMessage, setPropertyMessage] = useState<string | null>(null);
  const [propertyFailed, setPropertyFailed] = useState(false);
  const [propertySaving, setPropertySaving] = useState(false);

  const [kpiSettings, setKpiSettings] = useState<KpiSettingsRow | null>(null);
  const [kpiDraft, setKpiDraft] = useState<Record<string, string>>({});
  const [kpiMessage, setKpiMessage] = useState<string | null>(null);
  const [kpiFailed, setKpiFailed] = useState(false);
  const [kpiSaving, setKpiSaving] = useState(false);

  const [sites, setSites] = useState<GscSite[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesReloadKey, setSitesReloadKey] = useState(0);

  const loadAliases = useCallback(() => {
    fetch("/api/admin/member-aliases")
      .then((r) => r.json())
      .then((data) => {
        setAliases(data.aliases ?? []);
        setMemberNames(data.memberNames ?? []);
      });
  }, []);

  const loadProperties = useCallback(() => {
    fetch("/api/admin/project-gsc-properties")
      .then((r) => r.json())
      .then((data) => {
        setProperties(data.properties ?? []);
        setProjectNames(data.projectNames ?? []);
      });
  }, []);

  const loadKpiSettings = useCallback(() => {
    fetch("/api/admin/kpi-settings")
      .then((r) => r.json())
      .then((data) => {
        if (!data.settings) return;
        setKpiSettings(data.settings);
        setKpiDraft(
          Object.fromEntries(Object.entries(data.settings).map(([key, value]) => [key, String(value)])),
        );
      })
      .catch(() => setKpiSettings(null));
  }, []);

  useEffect(() => {
    loadAliases();
    loadProperties();
    loadKpiSettings();
  }, [loadAliases, loadProperties, loadKpiSettings]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/gsc-sites")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load Search Console properties");
        return data;
      })
      .then((data) => {
        if (!cancelled) setSites(data.sites ?? []);
      })
      .catch((error: Error) => {
        if (!cancelled) setSitesError(error.message);
      })
      .finally(() => {
        if (!cancelled) setSitesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sitesReloadKey]);

  function reloadSites() {
    setSites([]);
    setSitesError(null);
    setSitesLoading(true);
    setSitesReloadKey((key) => key + 1);
  }

  async function saveAlias() {
    if (!aliasName || !aliasEmail) return;
    await fetch("/api/admin/member-aliases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberName: aliasName, memberEmail: aliasEmail }),
    });
    setAliasName("");
    setAliasEmail("");
    loadAliases();
  }

  async function deleteAlias(memberName: string) {
    await fetch(`/api/admin/member-aliases?memberName=${encodeURIComponent(memberName)}`, { method: "DELETE" });
    loadAliases();
  }

  async function saveProperty() {
    if (!propProject || !propGscProperty) return;
    setPropertySaving(true);
    setPropertyFailed(false);
    setPropertyMessage(null);
    try {
      const response = await fetch("/api/admin/project-gsc-properties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project: propProject,
          gscProperty: propGscProperty,
          projectType: propProjectType,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save Search Console mapping");
      setPropProject("");
      setPropGscProperty("");
      setPropProjectType("growth");
      setPropertyMessage("Search Console mapping saved.");
      loadProperties();
    } catch (error) {
      setPropertyFailed(true);
      setPropertyMessage((error as Error).message);
    } finally {
      setPropertySaving(false);
    }
  }

  async function saveKpiSettings() {
    setKpiSaving(true);
    setKpiMessage(null);
    setKpiFailed(false);
    try {
      const res = await fetch("/api/admin/kpi-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only the fields this form renders. The row also carries the Layer 3
        // period weights now, and posting a stale copy of those back would
        // silently undo a change made in the weights panel above.
        body: JSON.stringify(
          Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.key, Number(kpiDraft[field.key])])),
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save KPI settings");
      setKpiSettings(data.settings);
      setKpiMessage("Saved. Run Recompute scores in Admin → Overview to apply it to existing ranges.");
    } catch (error) {
      setKpiFailed(true);
      setKpiMessage((error as Error).message);
    } finally {
      setKpiSaving(false);
    }
  }

  async function deleteProperty(project: string) {
    await fetch(`/api/admin/project-gsc-properties?project=${encodeURIComponent(project)}`, { method: "DELETE" });
    loadProperties();
  }

  const unmappedProjects = projectNames.filter((name) => !properties.some((p) => p.project === name));
  const knownSiteUrls = new Set(sites.map((s) => s.siteUrl));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-6">
      <PageHeader
        title="Settings"
        description="Map the Sheet's member names and projects onto Google accounts and Search Console properties."
      />

      <Card>
        <CardHeader
          title="Project → Search Console property"
          description="Only properties your Google account can read are listed. Pick the exact one — a domain property and a URL-prefix property are different sites to the API."
          action={
            <Button variant="secondary" onClick={reloadSites} disabled={sitesLoading}>
              {sitesLoading ? "Loading…" : "Reload"}
            </Button>
          }
        />

        <div className="space-y-4 px-5 py-4">
          {sitesError && (
            <div className="rounded-lg bg-negative-soft px-3 py-2 text-[13px] text-negative">
              Could not load Search Console properties — {sitesError}
            </div>
          )}
          {!sitesError && !sitesLoading && sites.length === 0 && (
            <div className="space-y-1.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
              <p className="font-medium">
                Search Console returned no properties for {session?.user?.email ?? "this account"}.
              </p>
              <p className="leading-5">
                Search Console access is granted per property, and is separate from Google Workspace admin rights — being
                a Workspace admin does not grant it. An owner of each property must add this address under{" "}
                <strong>Settings → Users and permissions</strong> in Search Console (Restricted is enough), then reload
                here.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Project">
              <input
                list="project-names"
                value={propProject}
                onChange={(e) => setPropProject(e.target.value)}
                placeholder="Project name from the Sheet"
                className={inputClass}
              />
              <datalist id="project-names">
                {projectNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field label="Search Console property">
              <select
                value={propGscProperty}
                onChange={(e) => setPropGscProperty(e.target.value)}
                className={inputClass}
                disabled={sites.length === 0}
              >
                <option value="">Select a property…</option>
                {sites.map((site) => (
                  <option key={site.siteUrl} value={site.siteUrl}>
                    {site.siteUrl} ({site.permissionLevel})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project type">
              <select
                value={propProjectType}
                onChange={(e) => setPropProjectType(e.target.value)}
                className={inputClass}
                title="Sets how much growth this project needs to score well"
              >
                <option value="new">New</option>
                <option value="growth">Growth</option>
                <option value="stable">Stable</option>
              </select>
            </Field>
            <Button onClick={saveProperty} disabled={!propProject || !propGscProperty || propertySaving}>
              {propertySaving ? "Saving..." : "Save mapping"}
            </Button>
          </div>

          {propertyMessage && (
            <p className={`text-[13px] ${propertyFailed ? "text-negative" : "text-ink-muted"}`}>{propertyMessage}</p>
          )}

          {unmappedProjects.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-muted">
              Unmapped projects:
              {unmappedProjects.map((name) => (
                <button
                  key={name}
                  onClick={() => setPropProject(name)}
                  className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning hover:underline"
                >
                  {name}
                </button>
              ))}
            </p>
          )}

          <ul className="divide-y divide-line rounded-lg border border-line">
            {properties.length === 0 && (
              <li className="px-3 py-3 text-[13px] text-ink-subtle">No project mapped yet.</li>
            )}
            {properties.map((property) => (
              <li key={property.project} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="text-sm text-ink">
                  <span className="font-medium">{property.project}</span>
                  <span className="mx-2 text-ink-subtle">→</span>
                  <code className="rounded bg-neutral-soft px-1.5 py-0.5 text-[13px]">{property.gsc_property}</code>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{PROJECT_TYPE_LABELS[property.project_type] ?? property.project_type}</Badge>
                  {sites.length > 0 && !knownSiteUrls.has(property.gsc_property) && (
                    <Badge tone="negative">Not in your GSC list</Badge>
                  )}
                  <Button variant="danger" onClick={() => deleteProperty(property.project)}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="KPI settings"
          description="How growth turns into a 0–100 score: hitting the target growth for the project's type scores 100, no growth scores 50. Saving does not rescore on its own — run Recompute scores in Admin → Overview."
        />
        <div className="space-y-4 px-5 py-4">
          {!kpiSettings && <p className="text-[13px] text-ink-subtle">Loading settings…</p>}
          {kpiSettings && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {KPI_FIELDS.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <input
                      type="number"
                      step={field.step}
                      value={kpiDraft[field.key] ?? ""}
                      onChange={(e) => setKpiDraft((draft) => ({ ...draft, [field.key]: e.target.value }))}
                      className={inputClass}
                    />
                    <span className="text-xs text-ink-subtle">{field.hint}</span>
                  </Field>
                ))}
              </div>
              <div className="border-t border-line pt-4">
                <h3 className="text-[13px] font-medium text-ink">Baseline &amp; anomalies</h3>
                <p className="mb-3 text-xs text-ink-subtle">
                  What the current period is compared against. With a single baseline period, a month that spiked
                  becomes the whole yardstick for the month after it, so returning to normal scores as a collapse.
                  Raising the lookback grades against several past periods instead, and months that stand too far
                  out from a URL&apos;s own history are left out of the comparison altogether.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {BASELINE_FIELDS.map((field) => (
                    <Field key={field.key} label={field.label}>
                      <input
                        type="number"
                        step={field.step}
                        value={kpiDraft[field.key] ?? ""}
                        onChange={(e) => setKpiDraft((draft) => ({ ...draft, [field.key]: e.target.value }))}
                        className={inputClass}
                      />
                      <span className="text-xs text-ink-subtle">{field.hint}</span>
                    </Field>
                  ))}
                </div>
              </div>
              <div className="border-t border-line pt-4">
                <h3 className="text-[13px] font-medium text-ink">Warning &amp; audit thresholds</h3>
                <p className="mb-3 text-xs text-ink-subtle">
                  When a declining URL is queued for a human to look at. A warning is never a score change: it says
                  a URL is costing a member measurable KPI points and someone should find out why. Impact is one of
                  the conditions on purpose &mdash; a URL can be down 80% and still not warn if it carries too
                  little of that member&apos;s traffic to move their number.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {WARNING_FIELDS.map((field) => (
                    <Field key={field.key} label={field.label}>
                      <input
                        type="number"
                        step={field.step}
                        value={kpiDraft[field.key] ?? ""}
                        onChange={(e) => setKpiDraft((draft) => ({ ...draft, [field.key]: e.target.value }))}
                        className={inputClass}
                      />
                      <span className="text-xs text-ink-subtle">{field.hint}</span>
                    </Field>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={saveKpiSettings} disabled={kpiSaving}>
                  {kpiSaving ? "Saving…" : "Save KPI settings"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setKpiDraft(
                      Object.fromEntries(Object.entries(kpiSettings).map(([key, value]) => [key, String(value)])),
                    )
                  }
                  disabled={kpiSaving}
                >
                  Reset
                </Button>
                {kpiMessage && (
                  <p className={`text-[13px] ${kpiFailed ? "text-negative" : "text-ink-muted"}`}>{kpiMessage}</p>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      <KpiWeightsPanel />

      <AuditRolesPanel />

      <Card>
        <CardHeader
          title="Member name → email"
          description="The Sheet only has names. Map each one to a Google account so that member sees their own URLs. Saving applies to URLs already synced."
        />

        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Member name">
              <input
                list="member-names"
                value={aliasName}
                onChange={(e) => setAliasName(e.target.value)}
                placeholder="Name as written in the Sheet"
                className={inputClass}
              />
              <datalist id="member-names">
                {memberNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field label="Google account email">
              <input
                type="email"
                value={aliasEmail}
                onChange={(e) => setAliasEmail(e.target.value)}
                placeholder="name@company.com"
                className={inputClass}
              />
            </Field>
            <Button onClick={saveAlias} disabled={!aliasName || !aliasEmail}>
              Save mapping
            </Button>
          </div>

          <ul className="divide-y divide-line rounded-lg border border-line">
            {aliases.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-subtle">No member mapped yet.</li>}
            {aliases.map((alias) => (
              <li key={alias.member_name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span className="text-sm text-ink">
                  <span className="font-medium">{alias.member_name}</span>
                  <span className="mx-2 text-ink-subtle">→</span>
                  {alias.member_email}
                </span>
                <Button variant="danger" onClick={() => deleteAlias(alias.member_name)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
