import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { listWorksForContentUrl } from "@/lib/repositories/content-url-works";
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

  const [rows, works] = await Promise.all([getPerformanceForContentUrl(id), listWorksForContentUrl(id)]);

  // Anyone who has worked on the URL may read it, not only whoever owns it now:
  // this URL can count towards their KPI for a period they worked in, and a
  // score you cannot open is a score you cannot check.
  const email = session.user.email.toLowerCase();
  const isOwner = contentUrl.member_email?.toLowerCase() === email;
  const isWorker = works.some((work) => work.member_email?.toLowerCase() === email);
  if (!session.user.isAdmin && !isOwner && !isWorker) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ contentUrl, rows, works });
}
