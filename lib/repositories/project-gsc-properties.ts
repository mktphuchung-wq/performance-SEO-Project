import { query } from "@/lib/db";

export interface ProjectGscProperty {
  project: string;
  gsc_property: string;
  notes: string | null;
}

export async function listProjectGscProperties(): Promise<ProjectGscProperty[]> {
  return query<ProjectGscProperty>(
    "select project, gsc_property, notes from public.project_gsc_properties order by project",
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
): Promise<void> {
  await query(
    `insert into public.project_gsc_properties (project, gsc_property, notes)
     values ($1, $2, $3)
     on conflict (project) do update set gsc_property = excluded.gsc_property, notes = excluded.notes, updated_at = now()`,
    [project, gscProperty, notes ?? null],
  );
}

export async function deleteProjectGscProperty(project: string): Promise<void> {
  await query("delete from public.project_gsc_properties where project = $1", [project]);
}
