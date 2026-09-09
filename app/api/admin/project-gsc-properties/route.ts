import { NextResponse } from "next/server";
import {
  gscPropertyCoversUrl,
  deleteProjectGscProperty,
  listProjectUrls,
  listProjectGscProperties,
  upsertProjectGscProperty,
} from "@/lib/repositories/project-gsc-properties";
import { listDistinctProjects } from "@/lib/repositories/content-urls";
import { PROJECT_TYPES, type ProjectType } from "@/lib/performance/score";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { listGscSites } from "@/lib/google";
import { classifyGoogleApiError } from "@/lib/google-errors";

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

  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  const projectNames = await listDistinctProjects();
  if (!projectNames.includes(project)) {
    return NextResponse.json({ error: "project must match an active project from the Sheet" }, { status: 400 });
  }

  try {
    const sites = await listGscSites(session.accessToken);
    if (!sites.some((site) => site.siteUrl === gscProperty)) {
      return NextResponse.json(
        { error: "gscProperty is not accessible to the signed-in Google account", code: "PROPERTY_ACCESS_DENIED" },
        { status: 422 },
      );
    }
  } catch (error) {
    const kind = classifyGoogleApiError(error);
    return NextResponse.json(
      { error: `Could not verify Search Console property: ${(error as Error).message}`, code: kind },
      { status: kind === "invalid_credentials" ? 401 : kind === "permission_denied" ? 403 : 502 },
    );
  }

  const uncoveredUrls = (await listProjectUrls(project)).filter((url) => !gscPropertyCoversUrl(gscProperty, url));
  if (uncoveredUrls.length > 0) {
    return NextResponse.json(
      {
        error: `The property does not cover ${uncoveredUrls.length} active URL(s) in ${project}`,
        code: "PROPERTY_URL_MISMATCH",
        sampleUrls: uncoveredUrls.slice(0, 5),
      },
      { status: 422 },
    );
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
