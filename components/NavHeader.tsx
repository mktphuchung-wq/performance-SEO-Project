"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-sm font-medium ${
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label}
    </Link>
  );
}

export function NavHeader() {
  const { data: session } = useSession();
  if (!session) return null;

  const isAdmin = session.user?.isAdmin;

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-slate-900 mr-4">Performance SEO</span>
          <NavLink href="/dashboard" label="Dashboard" />
          {isAdmin && (
            <>
              <NavLink href="/admin" label="Admin" />
              <NavLink href="/admin/members" label="Members" />
              <NavLink href="/admin/projects" label="Projects" />
              <NavLink href="/admin/urls" label="URLs" />
              <NavLink href="/admin/settings" label="Settings" />
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{session.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="rounded-md border px-3 py-1.5 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
