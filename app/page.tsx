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
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-sm w-full text-center space-y-6 bg-white border rounded-xl p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Performance SEO Project</h1>
          <p className="text-sm text-slate-500 mt-1">SEO Team internal dashboard</p>
        </div>
        <SignInButton />
      </div>
    </div>
  );
}
