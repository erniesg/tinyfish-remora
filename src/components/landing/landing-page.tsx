"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  Binary,
  Bot,
  CandlestickChart,
  ShieldAlert,
  Sparkles,
  Waves,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

const valueProps = [
  {
    title: "Recipe-to-trade in one surface",
    body: "Run TinyFish prompts, stream the operator trace, review scored signals, and route them into paper or live execution inside one product surface.",
    icon: Binary,
  },
  {
    title: "Agent-generated strategy drafts",
    body: "Give the system an objective and risk profile. It proposes a structured thesis, signal plan, entries, exits, and venue mapping you can save or reject.",
    icon: Bot,
  },
  {
    title: "Retail-grade guardrails",
    body: "P&L, per-strategy attribution, credential health, kill switches, and explicit paper-to-live promotion gates live in the same cockpit.",
    icon: ShieldAlert,
  },
];

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const context = gsap.context(() => {
      gsap.from(".hero-animate", {
        y: 28,
        opacity: 0,
        duration: 0.9,
        stagger: 0.08,
        ease: "power3.out",
      });

      gsap.from(".feature-card", {
        scrollTrigger: {
          trigger: ".feature-grid",
          start: "top 78%",
        },
        y: 36,
        opacity: 0,
        duration: 0.8,
        stagger: 0.15,
        ease: "power3.out",
      });

      gsap.from(".stack-card", {
        scrollTrigger: {
          trigger: ".stack-shell",
          start: "top 72%",
        },
        y: 40,
        opacity: 0,
        duration: 0.9,
        stagger: 0.18,
        ease: "power3.out",
      });
    }, rootRef);

    return () => context.revert();
  }, []);

  return (
    <div ref={rootRef} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(circle_at_top,_rgba(230,59,46,0.28),_transparent_60%)]" />
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <Link
          href="/"
          className="hero-animate inline-flex items-center gap-3 rounded-full border border-[var(--line)] bg-[rgba(10,10,10,0.85)] px-4 py-2 text-sm text-[var(--paper)] backdrop-blur-xl"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,255,255,0.2)] bg-[var(--signal)] text-[10px] font-bold tracking-[0.18em] text-black">
            TF
          </span>
          <span className="font-medium tracking-[0.2em] uppercase">tinyfish-remora</span>
        </Link>
        <nav className="hero-animate hidden items-center gap-3 md:flex">
          <a href="#surfaces" className="nav-link">
            Surfaces
          </a>
          <a href="#stack" className="nav-link">
            Stack
          </a>
          <Link href="/dashboard" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm">
            Open Demo
          </Link>
          <Link href="/auth" className="rounded-full bg-[var(--signal)] px-4 py-2 text-sm font-semibold text-black">
            Sign In
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-20 px-5 pb-24 sm:px-8">
        <section className="grid min-h-[82dvh] gap-12 pt-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="space-y-8">
            <div className="hero-animate inline-flex items-center gap-3 rounded-full border border-[rgba(230,59,46,0.32)] bg-[rgba(230,59,46,0.08)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              <Sparkles className="h-4 w-4 text-[var(--signal)]" />
              Alpha hunting for IBKR + Polymarket
            </div>
            <div className="space-y-6">
              <h1 className="hero-animate max-w-4xl text-5xl font-semibold leading-[0.94] tracking-[-0.06em] text-[var(--paper)] sm:text-7xl">
                Retail trading,
                <span className="block font-[var(--font-display)] italic text-[var(--signal)]">
                  with an agent that can invent the playbook.
                </span>
              </h1>
              <p className="hero-animate max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
                Users can pick a predefined TinyFish recipe or hand the objective to the agent.
                The system expands keywords, streams live operator traces, scores the signal stack,
                then paper-trades or arms live routing with clear guardrails.
              </p>
            </div>
            <div className="hero-animate flex flex-col gap-3 sm:flex-row">
              <Link href="/auth" className="primary-button">
                Create Account
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/dashboard" className="secondary-button">
                Launch Demo Cockpit
              </Link>
            </div>
            <div className="hero-animate grid gap-4 sm:grid-cols-3">
              {[
                { label: "Parallel collectors", value: "3" },
                { label: "Paper venues prewired", value: "2" },
                { label: "Saved strategy versions", value: "Live" },
              ].map((item) => (
                <div key={item.label} className="rounded-[1.75rem] border border-[var(--line)] bg-[rgba(255,255,255,0.03)] p-5">
                  <div className="text-3xl font-semibold text-[var(--paper)]">{item.value}</div>
                  <div className="mt-1 text-sm uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-animate relative">
            <div className="absolute inset-0 translate-x-5 translate-y-5 rounded-[2.5rem] border border-[rgba(230,59,46,0.24)] bg-[rgba(230,59,46,0.06)]" />
            <div className="relative rounded-[2.5rem] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-4 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                <span>Mission Control</span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--signal)]" />
                  Live signal stream
                </span>
              </div>
              <div className="mt-6 space-y-4">
                <div className="rounded-[1.75rem] border border-[rgba(230,59,46,0.24)] bg-[rgba(230,59,46,0.09)] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm uppercase tracking-[0.22em] text-[var(--muted)]">Autonomous strategy studio</div>
                      <div className="mt-2 text-2xl font-semibold">Policy lag into China-sensitive risk</div>
                    </div>
                    <CandlestickChart className="h-6 w-6 text-[var(--signal)]" />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/30 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Prompt hardening</div>
                      <div className="mt-2 text-sm text-[var(--paper)]">
                        Numbered steps. Cookie handling first. Explicit fallback JSON. Stream URL capture.
                      </div>
                    </div>
                    <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/30 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Execution gate</div>
                      <div className="mt-2 text-sm text-[var(--paper)]">
                        Review score 86/100. Paper receipt filled. Live route armed but confirmation still required.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    { label: "TinyFish", value: "streaming_url captured", icon: Waves },
                    { label: "IBKR", value: "paper + live controls", icon: CandlestickChart },
                    { label: "Polymarket", value: "L1 + L2 auth model", icon: ShieldAlert },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[1.75rem] border border-[var(--line)] bg-black/25 p-4">
                      <item.icon className="h-5 w-5 text-[var(--signal)]" />
                      <div className="mt-4 text-sm uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</div>
                      <div className="mt-1 text-lg font-medium">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="surfaces" className="feature-grid grid gap-5 lg:grid-cols-3">
          {valueProps.map((item) => (
            <article
              key={item.title}
              className="feature-card rounded-[2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-7"
            >
              <item.icon className="h-6 w-6 text-[var(--signal)]" />
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em]">{item.title}</h2>
              <p className="mt-3 text-base leading-7 text-[var(--muted)]">{item.body}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-8">
            <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Why this demo lands</div>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">
              It sells both the edge
              <span className="block font-[var(--font-display)] italic text-[var(--signal)]">and the operating model.</span>
            </h2>
            <p className="mt-4 text-lg leading-8 text-[var(--muted)]">
              The point is not just to show a strategy card. It is to show that prompt design,
              anti-bot handling, streaming visibility, scoring, venue routing, and live P&L belong
              in one continuous user experience.
            </p>
          </div>

          <div className="stack-shell grid gap-4 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Connect accounts",
                body: "Users sign in, add their own API keys or paper credentials, and see venue health instantly.",
              },
              {
                step: "02",
                title: "Run recipes or ask the agent",
                body: "Pick a predefined alpha recipe or generate a new one from plain-English objectives and constraints.",
              },
              {
                step: "03",
                title: "Watch the ledger update",
                body: "Signals, intent decisions, receipts, positions, and P&L all update as a single event trail.",
              },
            ].map((card) => (
              <div key={card.step} className="stack-card rounded-[2rem] border border-[var(--line)] bg-black/25 p-6">
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--signal)]">{card.step}</div>
                <div className="mt-4 text-2xl font-semibold">{card.title}</div>
                <p className="mt-3 leading-7 text-[var(--muted)]">{card.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="stack" className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
          <div className="rounded-[2.5rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-8">
            <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Core runtime loop</div>
            <div className="mt-4 text-4xl font-semibold tracking-[-0.05em]">
              Collect. Review. Decide. Execute.
            </div>
            <div className="mt-6 space-y-4">
              {[
                "Collect, review, decide, and execute stay visible as the backbone of the agent runtime.",
                "TinyFish streaming, anti-bot hardening, and batch fanout drive the collection layer.",
                "IBKR and Polymarket stay separate at the routing layer so paper and live modes can be promoted safely.",
              ].map((line) => (
                <div key={line} className="rounded-[1.5rem] border border-[var(--line)] bg-black/20 px-4 py-3 text-base text-[var(--paper)]">
                  {line}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[2.5rem] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(230,59,46,0.08),rgba(255,255,255,0.04))] p-8">
            <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Primary CTA</div>
            <div className="mt-4 text-4xl font-semibold tracking-[-0.05em]">
              Show the whole loop,
              <span className="block font-[var(--font-display)] italic text-[var(--signal)]">not just the model output.</span>
            </div>
            <p className="mt-4 leading-8 text-[var(--muted)]">
              This repo ships with a demo login, venue connection forms, strategy studio, live event
              timeline, and paper P&L cockpit so you can walk investors through the product in one go.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/dashboard" className="primary-button">
                Open Demo Cockpit
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/auth" className="secondary-button">
                Create Demo Account
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
