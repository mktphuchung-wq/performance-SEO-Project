import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { listGscSites } from "@/lib/google";
import { classifyGoogleApiError } from "@/lib/google-errors";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  try {
    const sites = await listGscSites(session.accessToken);
    return NextResponse.json({ sites });
  } catch (error) {
    const kind = classifyGoogleApiError(error);
    return NextResponse.json(
      { error: `${kind}: ${(error as Error).message}` },
      { status: kind === "permission_denied" ? 403 : 500 },
    );
  }
}
