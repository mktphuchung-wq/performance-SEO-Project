import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const adminPathPrefixes = ["/admin", "/api/admin", "/api/sync", "/api/refresh"];

export default withAuth(
  function proxy(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;
    const requiresAdmin = adminPathPrefixes.some((prefix) => pathname.startsWith(prefix));

    if (requiresAdmin && !token?.isAdmin) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => Boolean(token),
    },
  },
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/api/me/:path*",
    "/api/admin/:path*",
    "/api/sync/:path*",
    "/api/refresh/:path*",
  ],
};
