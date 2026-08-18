import { NextResponse } from "next/server";
import {
  deleteProjectGscProperty,
  listProjectGscProperties,
  upsertProjectGscProperty,
} from "@/lib/repositories/project-gsc-properties";
import { listDistinctProjects } from "@/lib/repositories/content-urls";
import { PROJECT_TYPES, type ProjectType } from "@/lib/performance/score";

export async function GET() {
  const [properties, projectNames] = await Promise.all([listProjectGscProperties(), listDistinctProjects()]);
  return NextResponse.json({ properties, projectNames });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const project = String(body.project ?? "").trim();
  const gscProperty = String(body.gscProperty ?? "").trim();
  const notes = body.notes ? String(body.notes) : undefined;

  if (!project || !gscProperty) {
    return NextResponse.json({ error: "project and gscProperty are required" }, { status: 400 });
  }

  // Left undefined when absent so an existing project keeps its current type
  // instead of being reset to the default.
  let projectType: ProjectType | undefined;
  if (body.projectType !== undefined && body.projectType !== null && body.projectType !== "") {
    const candidate = String(body.projectType);
    if (!PROJECT_TYPES.includes(candidate as ProjectType)) {
      return NextResponse.json(
        { error: `projectType must be one of: ${PROJECT_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
    projectType = candidate as ProjectType;
  }

  await upsertProjectGscProperty(project, gscProperty, notes, projectType);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project is required" }, { status: 400 });
  }
  await deleteProjectGscProperty(project);
  return NextResponse.json({ ok: true });
}
