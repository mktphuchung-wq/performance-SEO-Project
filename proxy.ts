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
        const status = token ? 403 : 401;
        const requestId = crypto.randomUUID();
        return NextResponse.json(
          {
            error: token ? "You do not have permission to access this resource." : "Please sign in to continue.",
            code: token ? "FORBIDDEN" : "UNAUTHORIZED",
            requestId,
          },
          { status, headers: { "x-request-id": requestId } },
        );
      }
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => req.nextUrl.pathname.startsWith("/api/") || Boolean(token),
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
