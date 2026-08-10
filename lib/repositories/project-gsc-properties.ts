import { query } from "@/lib/db";
import type { ProjectType } from "@/lib/performance/score";

export interface ProjectGscProperty {
  project: string;
  gsc_property: string;
  notes: string | null;
  project_type: ProjectType;
}

export async function listProjectGscProperties(): Promise<ProjectGscProperty[]> {
  return query<ProjectGscProperty>(
    "select project, gsc_property, notes, project_type from public.project_gsc_properties order by project",
  );
}

export async function getProjectGscPropertyMap(): Promise<Map<string, string>> {
  const rows = await listProjectGscProperties();
  return new Map(rows.map((row) => [row.project, row.gsc_property]));
}

export async function upsertProjectGscProperty(
  project: string,
  gscProperty: string,
  notes?: string,
  projectType?: ProjectType,
): Promise<void> {
  await query(
    // project_type is coalesced on both sides: a new row falls back to the
    // 'growth' default, and re-saving an existing mapping without naming a type
    // keeps whatever it already had rather than silently resetting it.
    `insert into public.project_gsc_properties (project, gsc_property, notes, project_type)
     values ($1, $2, $3, coalesce($4, 'growth'))
     on conflict (project) do update set
       gsc_property = excluded.gsc_property,
       notes = excluded.notes,
       project_type = coalesce($4, public.project_gsc_properties.project_type),
       updated_at = now()`,
    [project, gscProperty, notes ?? null, projectType ?? null],
  );
  // Apply to URLs already synced, so admins don't have to re-sync the Sheet
  // after fixing a mapping.
  await query(
    `update public.content_urls
       set gsc_property = $2, updated_at = now()
     where project = $1 and gsc_property is distinct from $2`,
    [project, gscProperty],
  );
}

export async function deleteProjectGscProperty(project: string): Promise<void> {
  await query("delete from public.project_gsc_properties where project = $1", [project]);
  await query(
    `update public.content_urls
       set gsc_property = null, updated_at = now()
     where project = $1 and gsc_property is not null`,
    [project],
  );
}
