import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getContentUrlById } from "@/lib/repositories/content-urls";
import { getPerformanceForContentUrl } from "@/lib/repositories/performance-cache";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const contentUrl = await getContentUrlById(id);
  if (!contentUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = contentUrl.member_email?.toLowerCase() === session.user.email.toLowerCase();
  if (!session.user.isAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await getPerformanceForContentUrl(id);
  return NextResponse.json({ contentUrl, rows });
}
