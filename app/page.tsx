import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SignInButton } from "@/components/SignInButton";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm space-y-7 rounded-2xl border border-line bg-surface p-8 shadow-[0_4px_16px_rgba(16,24,40,0.06)]">
        <div className="text-center">
          <h1 className="text-xl font-medium tracking-tight text-ink">Performance SEO Project</h1>
          <p className="mt-1.5 text-sm text-ink-muted">SEO team internal dashboard</p>
        </div>
        <SignInButton />
        <p className="text-center text-[13px] leading-5 text-ink-subtle">
          Sign in with the Google account that has access to the content sheet and your Search Console properties.
        </p>
      </div>
    </div>
  );
}
