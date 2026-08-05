"use client";

import { signIn } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
      className="w-full rounded-md bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800"
    >
      Sign in with Google
    </button>
  );
}
