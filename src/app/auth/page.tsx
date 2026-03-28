"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, UserPlus } from "lucide-react";
import {
  clearDemoSession,
  createDemoAccount,
  ensureDemoAccounts,
  readDemoSession,
  resumeDemoAccount,
  signInDemoAccount,
  type DemoAccount,
} from "@/lib/demo/auth";
import type { DemoUser } from "@/lib/demo/types";

export default function AuthPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [session, setSession] = useState<DemoUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "sign-in">("sign-in");
  const [name, setName] = useState("Operator");
  const [email, setEmail] = useState("operator@tinyfish.demo");
  const [company, setCompany] = useState("TinyFish");
  const [riskProfile, setRiskProfile] = useState<DemoUser["riskProfile"]>("balanced");
  const [passcode, setPasscode] = useState("2468");

  function syncLocalState(nextMessage?: string) {
    setAccounts(ensureDemoAccounts());
    setSession(readDemoSession());
    setMessage(nextMessage ?? null);
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncLocalState();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function handleResume(accountId: string) {
    try {
      const nextSession = resumeDemoAccount(accountId);
      setSession(nextSession);
      setAccounts(ensureDemoAccounts());
      setMessage(`Using ${nextSession.name} on this device.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the local profile.");
    }
  }

  function handleCreate() {
    try {
      const nextSession = createDemoAccount({
        name,
        email,
        company,
        riskProfile,
        passcode,
      });

      setSession(nextSession);
      setAccounts(ensureDemoAccounts());
      setMessage(`Created ${nextSession.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the local profile.");
    }
  }

  function handleSignIn() {
    try {
      const nextSession = signInDemoAccount({
        email,
        passcode,
      });

      setSession(nextSession);
      setAccounts(ensureDemoAccounts());
      setMessage(`Signed in as ${nextSession.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in to the local profile.");
    }
  }

  function handleSignOut() {
    clearDemoSession();
    setSession(null);
    setMessage("Cleared the current local session.");
  }

  return (
    <div className="min-h-[100dvh] px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[rgba(11,14,16,0.82)] shadow-[0_24px_120px_rgba(0,0,0,0.34)] animate-[stage-in_420ms_cubic-bezier(0.22,1,0.36,1)_both]">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:py-7">
          <div>
            <div className="text-[0.7rem] uppercase tracking-[0.34em] text-[var(--muted)]">
              tinyfish-remora
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-[var(--paper)] sm:text-4xl">
              Local profiles
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
              Optional device-only demo accounts. The dashboard works without this page, but this
              gives you seeded operators, passcodes, and quick session switching.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2.5 text-sm text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)] hover:bg-white/[0.04]"
          >
            Go to workbench
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.88fr)]">
          <section className="border-b border-[var(--line)] px-5 py-6 lg:border-r lg:border-b-0 sm:px-8 sm:py-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--muted)]">
                  Local accounts
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                  Pick a seeded operator or add your own
                </h2>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="rounded-[1.35rem] border border-[var(--line)] px-4 py-4"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--paper)]">{account.name}</div>
                      <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                        {account.email}
                      </div>
                      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                        {account.company || "Independent"} · {account.riskProfile} · passcode{" "}
                        {account.passcode}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleResume(account.id)}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--signal)] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#ff785b]"
                    >
                      Use profile
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="inline-flex rounded-full border border-[var(--line)] bg-white/[0.02] p-1">
              <button
                type="button"
                onClick={() => setMode("sign-in")}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  mode === "sign-in"
                    ? "bg-[var(--signal)] text-black"
                    : "text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("create")}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  mode === "create"
                    ? "bg-[var(--signal)] text-black"
                    : "text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                Create
              </button>
            </div>

            <div className="mt-6 space-y-4">
              {mode === "create" ? (
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    Name
                  </span>
                  <input
                    className="input-shell"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              ) : null}

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                  Email
                </span>
                <input
                  className="input-shell"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              {mode === "create" ? (
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    Company
                  </span>
                  <input
                    className="input-shell"
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                  />
                </label>
              ) : null}

              {mode === "create" ? (
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    Risk profile
                  </span>
                  <select
                    className="input-shell"
                    value={riskProfile}
                    onChange={(event) =>
                      setRiskProfile(event.target.value as DemoUser["riskProfile"])
                    }
                  >
                    <option value="conservative">Conservative</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </label>
              ) : null}

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                  Passcode
                </span>
                <input
                  className="input-shell"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {mode === "create" ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--signal)] px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#ff785b]"
                >
                  <UserPlus className="h-4 w-4" />
                  Create local profile
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--signal)] px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#ff785b]"
                >
                  <KeyRound className="h-4 w-4" />
                  Sign in locally
                </button>
              )}

              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--line)] px-5 py-3 text-sm text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)] hover:bg-white/[0.04]"
              >
                Enter workbench
                <ArrowRight className="h-4 w-4" />
              </button>

              {session ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--line)] px-5 py-3 text-sm text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)] hover:bg-white/[0.04]"
                >
                  Clear session
                </button>
              ) : null}
            </div>

            <div className="mt-6 rounded-[1.35rem] border border-[var(--line)] px-4 py-4 text-sm leading-7 text-[var(--muted)]">
              <div className="text-[var(--paper)]">Current session</div>
              <div className="mt-2">
                {session
                  ? `${session.name} · ${session.email} · ${session.riskProfile}`
                  : "No local session loaded yet."}
              </div>
              {message ? <div className="mt-3 text-[var(--paper)]">{message}</div> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
