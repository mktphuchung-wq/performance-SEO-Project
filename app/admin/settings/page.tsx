"use client";

import { useEffect, useState } from "react";

interface MemberAlias {
  member_name: string;
  member_email: string;
}

interface ProjectGscProperty {
  project: string;
  gsc_property: string;
  notes: string | null;
}

export default function AdminSettingsPage() {
  const [aliases, setAliases] = useState<MemberAlias[]>([]);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [aliasName, setAliasName] = useState("");
  const [aliasEmail, setAliasEmail] = useState("");

  const [properties, setProperties] = useState<ProjectGscProperty[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [propProject, setPropProject] = useState("");
  const [propGscProperty, setPropGscProperty] = useState("");

  function loadAliases() {
    fetch("/api/admin/member-aliases")
      .then((r) => r.json())
      .then((data) => {
        setAliases(data.aliases ?? []);
        setMemberNames(data.memberNames ?? []);
      });
  }

  function loadProperties() {
    fetch("/api/admin/project-gsc-properties")
      .then((r) => r.json())
      .then((data) => {
        setProperties(data.properties ?? []);
        setProjectNames(data.projectNames ?? []);
      });
  }

  useEffect(() => {
    loadAliases();
    loadProperties();
  }, []);

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
      body: JSON.stringify({ project: propProject, gscProperty: propGscProperty }),
    });
    setPropProject("");
    setPropGscProperty("");
    loadProperties();
  }

  async function deleteProperty(project: string) {
    await fetch(`/api/admin/project-gsc-properties?project=${encodeURIComponent(project)}`, { method: "DELETE" });
    loadProperties();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-8">
      <h1 className="text-lg font-semibold text-slate-900">Settings</h1>

      <section className="bg-white border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Member name → email</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            The sheet only has member names. Map each name to the Google account email so members see their own URLs.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            list="member-names"
            value={aliasName}
            onChange={(e) => setAliasName(e.target.value)}
            placeholder="Member name"
            className="border rounded-md text-sm px-2 py-1.5"
          />
          <datalist id="member-names">
            {memberNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <input
            value={aliasEmail}
            onChange={(e) => setAliasEmail(e.target.value)}
            placeholder="email@company.com"
            className="border rounded-md text-sm px-2 py-1.5"
          />
          <button onClick={saveAlias} className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5">
            Save
          </button>
        </div>

        <ul className="divide-y">
          {aliases.map((alias) => (
            <li key={alias.member_name} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                {alias.member_name} → {alias.member_email}
              </span>
              <button onClick={() => deleteAlias(alias.member_name)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Project → Search Console property</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            e.g. <code>sc-domain:example.com</code> or <code>https://example.com/</code>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            list="project-names"
            value={propProject}
            onChange={(e) => setPropProject(e.target.value)}
            placeholder="Project"
            className="border rounded-md text-sm px-2 py-1.5"
          />
          <datalist id="project-names">
            {projectNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <input
            value={propGscProperty}
            onChange={(e) => setPropGscProperty(e.target.value)}
            placeholder="sc-domain:example.com"
            className="border rounded-md text-sm px-2 py-1.5"
          />
          <button onClick={saveProperty} className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5">
            Save
          </button>
        </div>

        <ul className="divide-y">
          {properties.map((property) => (
            <li key={property.project} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                {property.project} → {property.gsc_property}
              </span>
              <button onClick={() => deleteProperty(property.project)} className="text-xs text-red-600 hover:underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
