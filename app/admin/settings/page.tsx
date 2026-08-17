"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
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
    await fetch("/api/admin/project-gsc-properties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: propProject,
        gscProperty: propGscProperty,
        projectType: propProjectType,
      }),
    });
    setPropProject("");
    setPropGscProperty("");
    setPropProjectType("growth");
    loadProperties();
  }

  async function saveKpiSettings() {
    setKpiSaving(true);
    setKpiMessage(null);
    setKpiFailed(false);
    try {
      const res = await fetch("/api/admin/kpi-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(Object.entries(kpiDraft).map(([key, value]) => [key, Number(value)])),
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
            <Button onClick={saveProperty} disabled={!propProject || !propGscProperty}>
              Save mapping
            </Button>
          </div>

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
