"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-accent-soft text-accent-hover" : "text-ink-muted hover:bg-neutral-soft hover:text-ink"
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
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <Link href="/dashboard" className="mr-3 text-sm font-medium tracking-tight text-ink">
            Performance SEO
          </Link>
          <NavLink href="/dashboard" label="Dashboard" />
          {isAdmin && (
            <>
              <NavLink href="/admin" label="Overview" exact />
              <NavLink href="/admin/members" label="Members" />
              <NavLink href="/admin/projects" label="Projects" />
              <NavLink href="/admin/urls" label="URLs" />
              <NavLink href="/admin/settings" label="Settings" />
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-hover">Admin</span>
          )}
          <span className="hidden text-[13px] text-ink-muted sm:inline">{session.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-neutral-soft"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
