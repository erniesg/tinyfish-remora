"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, UserRound } from "lucide-react";
import type { DemoUser } from "@/lib/demo/types";

const USER_KEY = "tinyfish-remora-user";

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "create">("create");
  const [name, setName] = useState("Ernie Demo");
  const [email, setEmail] = useState("ernie@tinyfish.demo");
  const [company, setCompany] = useState("TinyFish Labs");
  const [riskProfile, setRiskProfile] = useState<DemoUser["riskProfile"]>("balanced");

  function persistUser() {
    const user: DemoUser = {
      id: makeId("user"),
      name,
      email,
      company,
      riskProfile,
    };
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    router.push("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col gap-10 px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--paper)]">
          Back to landing
        </Link>
        <div className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Demo auth surface</div>
      </header>

      <main className="grid flex-1 gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[2.4rem] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-[rgba(230,59,46,0.28)] bg-[rgba(230,59,46,0.08)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            <UserRound className="h-4 w-4 text-[var(--signal)]" />
            {mode === "create" ? "Create account" : "Sign in"}
          </div>
          <h1 className="mt-6 text-5xl font-semibold tracking-[-0.06em] text-[var(--paper)]">
            Start in demo mode,
            <span className="block font-[var(--font-display)] italic text-[var(--signal)]">
              then wire real auth later.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            The repo runs without Clerk or Supabase keys so the demo works immediately. The forms
            below persist a local user profile, and the README includes the env seams for swapping
            in production auth and storage.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              "Local demo account persistence",
              "Credential health forms inside the dashboard",
              "Paper-first execution and promotion controls",
              "Clerk + Supabase-ready environment variables",
            ].map((line) => (
              <div key={line} className="rounded-[1.7rem] border border-[var(--line)] bg-black/20 px-4 py-3 text-sm leading-7 text-[var(--paper)]">
                {line}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2.4rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-8">
          <div className="flex gap-3">
            <button
              className={`rounded-full px-4 py-2 text-sm ${mode === "create" ? "bg-[var(--signal)] font-semibold text-black" : "border border-[var(--line)] text-[var(--paper)]"}`}
              onClick={() => setMode("create")}
            >
              Create account
            </button>
            <button
              className={`rounded-full px-4 py-2 text-sm ${mode === "sign-in" ? "bg-[var(--signal)] font-semibold text-black" : "border border-[var(--line)] text-[var(--paper)]"}`}
              onClick={() => setMode("sign-in")}
            >
              Sign in
            </button>
          </div>

          <div className="mt-8 grid gap-4">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Name</span>
              <input className="input-shell" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Email</span>
              <input className="input-shell" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Company</span>
              <input className="input-shell" value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Risk profile</span>
              <select
                className="input-shell"
                value={riskProfile}
                onChange={(event) => setRiskProfile(event.target.value as DemoUser["riskProfile"])}
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
          </div>

          <button className="primary-button mt-8 w-full justify-center" onClick={persistUser}>
            {mode === "create" ? "Create demo account" : "Enter demo cockpit"}
            <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
            The same surface can later be wrapped with Clerk&apos;s <code>{`<SignIn />`}</code> and
            <code>{` <SignUp />`}</code> components once publishable and secret keys are available.
          </p>
        </section>
      </main>
    </div>
  );
}
