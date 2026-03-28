"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CirclePause,
  Gauge,
  KeyRound,
  LogOut,
  Radar,
  Shield,
  Sparkles,
  Waves,
} from "lucide-react";
import {
  buildSeedConnections,
  buildSeedPositions,
  buildSeedStrategies,
  RECIPES,
} from "@/lib/demo/mock-data";
import {
  assessConnection,
  buildRunBatch,
} from "@/lib/demo/engine";
import type {
  AgentEvent,
  DemoUser,
  ExecutionMode,
  GeneratedStrategyResponse,
  Position,
  RunSummary,
  StrategyVersion,
  Venue,
  VenueConnection,
} from "@/lib/demo/types";

const USER_KEY = "tinyfish-remora-user";
const CONNECTIONS_KEY = "tinyfish-remora-connections";
const STRATEGIES_KEY = "tinyfish-remora-strategies";
const POSITIONS_KEY = "tinyfish-remora-positions";
const EVENTS_KEY = "tinyfish-remora-events";
const RUNS_KEY = "tinyfish-remora-runs";

function readLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function runProgressLabel(progress: number): string {
  if (progress < 20) return "boot";
  if (progress < 45) return "collect";
  if (progress < 70) return "review";
  if (progress < 90) return "decide";
  return "execute";
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

async function consumeSse(
  url: string,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const response = await fetch(url, { method: "GET", cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`SSE stream failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n\n")) {
      const boundary = buffer.indexOf("\n\n");
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      onEvent(JSON.parse(dataLine.slice(6)) as AgentEvent);
    }
  }
}

export function DashboardShell() {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const [user, setUser] = useState<DemoUser | null>(() => readLocalStorage<DemoUser | null>(USER_KEY, null));
  const [connections, setConnections] = useState<VenueConnection[]>(() =>
    readLocalStorage(CONNECTIONS_KEY, buildSeedConnections()).map(assessConnection),
  );
  const [strategies, setStrategies] = useState<StrategyVersion[]>(() =>
    readLocalStorage(STRATEGIES_KEY, buildSeedStrategies()),
  );
  const [positions, setPositions] = useState<Position[]>(() =>
    readLocalStorage(POSITIONS_KEY, buildSeedPositions()),
  );
  const [events, setEvents] = useState<AgentEvent[]>(() =>
    readLocalStorage<AgentEvent[]>(EVENTS_KEY, []),
  );
  const [runs, setRuns] = useState<RunSummary[]>(() =>
    readLocalStorage<RunSummary[]>(RUNS_KEY, []),
  );
  const [objective, setObjective] = useState(
    "Generate a low-latency strategy that hunts official non-English policy updates and maps them to the best paper-trading venue."
  );
  const [riskProfile, setRiskProfile] = useState<DemoUser["riskProfile"]>(
    () => readLocalStorage<DemoUser | null>(USER_KEY, null)?.riskProfile ?? "balanced",
  );
  const [preferredVenue, setPreferredVenue] = useState<"ibkr" | "polymarket" | "both">("both");
  const [generated, setGenerated] = useState<GeneratedStrategyResponse | null>(null);
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>(["ndrc-policy-lag", "polymarket-divergence"]);
  const [selectedStrategyId, setSelectedStrategyId] = useState("strategy-mandarin-lag");
  const [killSwitch, setKillSwitch] = useState(false);
  const [runError, setRunError] = useState<string>("");
  const [isGenerating, startGenerating] = useTransition();

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(CONNECTIONS_KEY, connections);
  }, [connections, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(STRATEGIES_KEY, strategies);
  }, [strategies, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(POSITIONS_KEY, positions);
  }, [positions, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(EVENTS_KEY, events);
  }, [events, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(RUNS_KEY, runs);
  }, [runs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const interval = window.setInterval(() => {
      setPositions((current) =>
        current.map((position, index) => {
          if (position.status !== "open") return position;
          const direction = index % 2 === 0 ? 1 : -1;
          const basisMove = position.venue === "ibkr" ? 0.11 : 0.01;
          const nextMark = Number((position.markPrice + direction * basisMove).toFixed(2));
          return {
            ...position,
            markPrice: nextMark,
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    }, 4000);

    return () => window.clearInterval(interval);
  }, [hydrated]);

  const readyConnections = connections.filter((connection) => connection.status === "ready").length;
  const liveWarnings = connections.filter((connection) => connection.mode === "live" && connection.status !== "missing").length;
  const totalExposure = positions.reduce((sum, position) => sum + position.markPrice * position.quantity, 0);
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (position.markPrice - position.entryPrice) * position.quantity,
    0,
  );
  const strategyMode = strategies.find((strategy) => strategy.id === selectedStrategyId)?.execution.mode ?? "paper";

  if (!hydrated) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl items-center justify-center px-5 py-16 sm:px-8">
        <div className="rounded-[2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-8 py-6 text-lg text-[var(--muted)]">
          Loading mission control...
        </div>
      </div>
    );
  }

  function updateConnectionField(connectionId: string, field: string, value: string) {
    setConnections((current) =>
      current.map((connection) => {
        if (connection.id !== connectionId) return connection;
        return assessConnection({
          ...connection,
          fields: {
            ...connection.fields,
            [field]: value,
          },
        });
      }),
    );
  }

  function toggleRecipe(recipeId: string) {
    setSelectedRecipes((current) =>
      current.includes(recipeId)
        ? current.filter((id) => id !== recipeId)
        : [...current, recipeId],
    );
  }

  function upsertPosition(position: Position, strategyName: string) {
    setPositions((current) => {
      const existingIndex = current.findIndex(
        (item) => item.instrument === position.instrument && item.venue === position.venue,
      );
      const nextPosition = {
        ...position,
        strategyName,
      };
      if (existingIndex === -1) return [nextPosition, ...current].slice(0, 12);
      const copy = [...current];
      copy[existingIndex] = nextPosition;
      return copy;
    });
  }

  function appendEvent(event: AgentEvent) {
    setEvents((current) => [event, ...current].slice(0, 48));
    setRuns((current) => {
      const runIndex = current.findIndex((run) => run.id === event.runId);
      const nextRun: RunSummary = {
        id: event.runId,
        title: RECIPES.find((recipe) => recipe.id === event.recipeId)?.title ?? "Unknown run",
        mode: event.receipt?.mode ?? strategyMode,
        venue: (event.receipt?.venue ?? event.signal?.venue ?? "ibkr") as Venue,
        status: event.phase === "COMPLETE" ? "complete" : "running",
        completedAt: event.phase === "COMPLETE" ? event.timestamp : current[runIndex]?.completedAt,
        lastMessage: event.message,
      };
      if (runIndex === -1) return [nextRun, ...current].slice(0, 10);
      const copy = [...current];
      copy[runIndex] = nextRun;
      return copy;
    });

    if (event.phase === "RECEIPT" && event.position) {
      const strategyName =
        strategies.find((strategy) => strategy.id === event.position?.strategyId)?.name ??
        RECIPES.find((recipe) => recipe.id === event.recipeId)?.title ??
        "Autonomous strategy";
      upsertPosition(event.position, strategyName);
    }
  }

  async function launchRun(mode: ExecutionMode, recipeIds = selectedRecipes, strategyId = selectedStrategyId) {
    if (killSwitch) {
      setRunError("Kill switch is active. Disable it before launching new runs.");
      return;
    }

    setRunError("");
    const batch = buildRunBatch({
      recipeIds,
      strategyId,
      mode,
    });

    setRuns((current) => [
      ...batch.runs.map((run) => ({
        id: run.runId,
        title: run.title,
        mode: run.mode,
        venue: run.venue,
        status: "running" as const,
        lastMessage: "Queued for streaming...",
      })),
      ...current,
    ].slice(0, 10));

    await Promise.all(
      batch.runs.map(async (run) => {
        try {
          await consumeSse(run.streamUrl, appendEvent);
        } catch (error) {
          setRunError(error instanceof Error ? error.message : String(error));
        }
      }),
    );
  }

  function generateStrategy() {
    startGenerating(async () => {
      const response = await fetch("/api/demo/generate-strategy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          objective,
          riskProfile,
          preferredVenue,
        }),
      });

      const payload = (await response.json()) as GeneratedStrategyResponse;
      setGenerated(payload);
      setSelectedRecipes(payload.strategy.recipeIds);
    });
  }

  function saveGeneratedStrategy() {
    if (!generated) return;
    const nextStrategies = [generated.strategy, ...strategies];
    setStrategies(nextStrategies);
    setSelectedStrategyId(generated.strategy.id);
    setGenerated(null);
  }

  function armLiveMode(strategyId: string) {
    setStrategies((current) =>
      current.map((strategy) =>
        strategy.id === strategyId
          ? {
              ...strategy,
              execution: {
                ...strategy.execution,
                mode: strategy.execution.mode === "paper" ? "live" : "paper",
              },
            }
          : strategy,
      ),
    );
  }

  function signOut() {
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-8">
      <header className="grid gap-6 rounded-[2.4rem] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-3 rounded-full border border-[rgba(230,59,46,0.26)] bg-[rgba(230,59,46,0.08)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
            <Radar className="h-4 w-4 text-[var(--signal)]" />
            Autonomous alpha hunting console
          </div>
          <div>
            <div className="text-4xl font-semibold tracking-[-0.05em] text-[var(--paper)] sm:text-5xl">
              TinyFish recipes, venue controls,
              <span className="block font-[var(--font-display)] italic text-[var(--signal)]">
                and live P&amp;L in one loop.
              </span>
            </div>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--muted)]">
              This hackathon demo brings signal collection, venue controls, strategy generation,
              live streaming, and paper or live execution review into one retail-facing cockpit.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="primary-button" onClick={() => launchRun(strategyMode)}>
              Launch Parallel Fanout
              <ArrowRight className="h-4 w-4" />
            </button>
            <button className="secondary-button" onClick={() => setKillSwitch((current) => !current)}>
              {killSwitch ? "Resume Routing" : "Global Kill Switch"}
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[2rem] border border-[var(--line)] bg-black/20 p-5">
            <div className="flex items-center justify-between text-sm uppercase tracking-[0.24em] text-[var(--muted)]">
              <span>Operator</span>
              {user ? (
                <button className="inline-flex items-center gap-2 text-[var(--paper)]" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              ) : (
                <Link href="/auth" className="text-[var(--paper)]">
                  Demo sign in
                </Link>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-2xl font-semibold">
                  {user?.name ?? "Demo operator"}
                </div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  {user?.email ?? "Use the auth page to persist your own account profile."}
                </div>
              </div>
              <div className="rounded-full border border-[var(--line)] px-3 py-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                {killSwitch ? "Paused" : "Routing armed"}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label: "Ready venues",
                value: `${readyConnections}/4`,
                tone: "text-[var(--paper)]",
              },
              {
                label: "Live warnings",
                value: `${liveWarnings}`,
                tone: "text-[var(--signal)]",
              },
              {
                label: "Open P&L",
                value: formatCurrency(unrealizedPnl),
                tone: unrealizedPnl >= 0 ? "text-emerald-300" : "text-rose-300",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-[1.75rem] border border-[var(--line)] bg-black/20 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</div>
                <div className={`mt-2 text-3xl font-semibold ${item.tone}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {runError ? (
        <div className="rounded-[1.6rem] border border-[rgba(230,59,46,0.25)] bg-[rgba(230,59,46,0.09)] px-5 py-4 text-sm text-[var(--paper)]">
          {runError}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Strategy studio</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Ask the agent for a new edge</div>
            </div>
            <Bot className="h-7 w-7 text-[var(--signal)]" />
          </div>

          <div className="mt-6 grid gap-4">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Objective</span>
              <textarea
                className="input-shell min-h-32 resize-none"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
            </label>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Risk</span>
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
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Venue bias</span>
                <select
                  className="input-shell"
                  value={preferredVenue}
                  onChange={(event) => setPreferredVenue(event.target.value as "ibkr" | "polymarket" | "both")}
                >
                  <option value="both">Both</option>
                  <option value="ibkr">IBKR</option>
                  <option value="polymarket">Polymarket</option>
                </select>
              </label>
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Action</span>
                <button className="primary-button w-full justify-center" onClick={generateStrategy}>
                  {isGenerating ? "Generating..." : "Generate Strategy"}
                </button>
              </div>
            </div>
          </div>

          {generated ? (
            <div className="mt-6 rounded-[1.9rem] border border-[rgba(230,59,46,0.24)] bg-[rgba(230,59,46,0.08)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Generated draft</div>
                  <div className="mt-2 text-2xl font-semibold">{generated.strategy.name}</div>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--paper)]">{generated.strategy.thesis}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="secondary-button" onClick={saveGeneratedStrategy}>
                    Save Version
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => launchRun("paper", generated.strategy.recipeIds, generated.strategy.id)}
                  >
                    Run Paper Preview
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {generated.scorecard.map((item) => (
                  <div key={item.label} className="rounded-[1.5rem] border border-[var(--line)] bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</div>
                    <div className="mt-2 text-3xl font-semibold text-[var(--signal)]">{item.score}</div>
                    <div className="mt-2 text-sm leading-6 text-[var(--paper)]">{item.note}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Entry + exit</div>
                  <div className="mt-3 space-y-2 text-sm leading-7 text-[var(--paper)]">
                    {generated.strategy.entryRules.concat(generated.strategy.exitRules).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Reasoning trace</div>
                  <div className="mt-3 space-y-2 text-sm leading-7 text-[var(--paper)]">
                    {generated.reasoning.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Recipe marketplace</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Lift-and-shift plays ready now</div>
            </div>
            <Sparkles className="h-6 w-6 text-[var(--signal)]" />
          </div>

          <div className="mt-6 grid gap-4">
            {RECIPES.map((recipe) => {
              const selected = selectedRecipes.includes(recipe.id);
              return (
                <button
                  type="button"
                  key={recipe.id}
                  className={`rounded-[1.9rem] border p-5 text-left transition ${selected ? "border-[rgba(230,59,46,0.4)] bg-[rgba(230,59,46,0.08)]" : "border-[var(--line)] bg-black/20"}`}
                  onClick={() => toggleRecipe(recipe.id)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{recipe.sourceLocale}</div>
                      <div className="mt-2 text-2xl font-semibold">{recipe.title}</div>
                      <div className="mt-1 text-sm text-[var(--muted)]">{recipe.subtitle}</div>
                    </div>
                    <div className="rounded-full border border-[var(--line)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[var(--paper)]">
                      {recipe.primaryVenue}
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-[var(--paper)]">{recipe.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {recipe.keywords.slice(0, 4).map((keyword) => (
                      <span key={keyword} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]">
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    <div className="rounded-[1.25rem] border border-[var(--line)] bg-black/20 p-3 text-sm leading-6 text-[var(--paper)]">
                      <span className="block text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Anti-bot</span>
                      {recipe.antiBotPolicy[0]}
                    </div>
                    <div className="rounded-[1.25rem] border border-[var(--line)] bg-black/20 p-3 text-sm leading-6 text-[var(--paper)]">
                      <span className="block text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Fallback</span>
                      {recipe.fallbackPolicy[0]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Venue connections</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Paper first, live when you are ready</div>
            </div>
            <KeyRound className="h-6 w-6 text-[var(--signal)]" />
          </div>
          <div className="mt-6 grid gap-4">
            {connections.map((connection) => (
              <div key={connection.id} className="rounded-[1.9rem] border border-[var(--line)] bg-black/20 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{connection.mode}</div>
                    <div className="mt-2 text-2xl font-semibold">{connection.label}</div>
                    <div className="mt-1 text-sm text-[var(--muted)]">{connection.description}</div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.22em] ${connection.status === "ready" ? "bg-emerald-500/15 text-emerald-200" : connection.status === "warning" ? "bg-amber-500/15 text-amber-200" : "bg-white/8 text-[var(--muted)]"}`}>
                    {connection.status}
                  </div>
                </div>
                <div className="mt-4 text-sm text-[var(--paper)]">{connection.statusNote}</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {Object.entries(connection.fields).map(([field, value]) => (
                    <label key={field} className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{field}</span>
                      <input
                        className="input-shell"
                        value={value}
                        onChange={(event) => updateConnectionField(connection.id, field, event.target.value)}
                        placeholder={`Enter ${field}`}
                        type={field.toLowerCase().includes("key") || field.toLowerCase().includes("secret") ? "password" : "text"}
                      />
                      {value ? (
                        <span className="text-xs text-[var(--muted)]">Stored as {maskValue(value)}</span>
                      ) : null}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-5">
          <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Strategy book</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Saved versions + promotion controls</div>
              </div>
              <Shield className="h-6 w-6 text-[var(--signal)]" />
            </div>
            <div className="mt-6 grid gap-4">
              {strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  className={`rounded-[1.9rem] border p-5 ${selectedStrategyId === strategy.id ? "border-[rgba(230,59,46,0.4)] bg-[rgba(230,59,46,0.08)]" : "border-[var(--line)] bg-black/20"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <button
                        className="text-left"
                        onClick={() => {
                          setSelectedStrategyId(strategy.id);
                          setSelectedRecipes(strategy.recipeIds);
                        }}
                      >
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          v{strategy.version} · {strategy.source}
                        </div>
                        <div className="mt-2 text-2xl font-semibold">{strategy.name}</div>
                      </button>
                      <div className="mt-2 max-w-2xl text-sm leading-7 text-[var(--paper)]">{strategy.thesis}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button className="secondary-button" onClick={() => armLiveMode(strategy.id)}>
                        {strategy.execution.mode === "paper" ? "Arm Live" : "Return to Paper"}
                      </button>
                      <button className="primary-button" onClick={() => launchRun(strategy.execution.mode, strategy.recipeIds, strategy.id)}>
                        Run {strategy.execution.mode}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Risk cap</div>
                      <div className="mt-2 text-lg font-semibold">{formatCurrency(strategy.risk.perTradeMaxUsd)}</div>
                    </div>
                    <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Venues</div>
                      <div className="mt-2 text-lg font-semibold">{strategy.venues.join(" + ")}</div>
                    </div>
                    <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Last note</div>
                      <div className="mt-2 text-sm leading-6 text-[var(--paper)]">{strategy.lastRunLabel ?? "No runs yet."}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Risk + P&amp;L</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Positions stay auditable</div>
              </div>
              <Gauge className="h-6 w-6 text-[var(--signal)]" />
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                {
                  label: "Gross exposure",
                  value: formatCurrency(totalExposure),
                  note: "Across open paper and live-marked positions.",
                },
                {
                  label: "Unrealized P&L",
                  value: formatCurrency(unrealizedPnl),
                  note: "Mark-to-market updates every few seconds in demo mode.",
                },
                {
                  label: "Open positions",
                  value: `${positions.length}`,
                  note: "Attribution remains strategy-aware for the cockpit.",
                },
              ].map((card) => (
                <div key={card.label} className="rounded-[1.6rem] border border-[var(--line)] bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{card.label}</div>
                  <div className="mt-2 text-3xl font-semibold">{card.value}</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--muted)]">{card.note}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 overflow-hidden rounded-[1.7rem] border border-[var(--line)]">
              <div className="grid grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_0.7fr] gap-3 bg-black/30 px-4 py-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                <div>Instrument</div>
                <div>Strategy</div>
                <div>Entry</div>
                <div>Mark</div>
                <div>P&amp;L</div>
              </div>
              {positions.map((position) => {
                const pnl = (position.markPrice - position.entryPrice) * position.quantity;
                return (
                  <div
                    key={position.id}
                    className="grid grid-cols-[1.2fr_0.8fr_0.6fr_0.6fr_0.7fr] gap-3 border-t border-[var(--line)] px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="font-semibold">{position.instrument}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {position.venue} · {position.mode}
                      </div>
                    </div>
                    <div className="text-[var(--paper)]">{position.strategyName}</div>
                    <div>{formatCurrency(position.entryPrice)}</div>
                    <div>{formatCurrency(position.markPrice)}</div>
                    <div className={pnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
                      {formatCurrency(pnl)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Run board</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Parallel alpha fanout</div>
            </div>
            <Waves className="h-6 w-6 text-[var(--signal)]" />
          </div>

          <div className="mt-6 grid gap-4">
            {runs.length === 0 ? (
              <div className="rounded-[1.8rem] border border-[var(--line)] bg-black/20 p-5 text-sm leading-7 text-[var(--muted)]">
                No active or historical runs yet. Launch a recipe batch to populate the stream, receipts, and P&amp;L ledger.
              </div>
            ) : (
              runs.map((run) => {
                const runEvents = events.filter((event) => event.runId === run.id);
                const progress = runEvents[0]?.progress ?? (run.status === "complete" ? 100 : 0);
                return (
                  <div key={run.id} className="rounded-[1.8rem] border border-[var(--line)] bg-black/20 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {run.venue} · {run.mode} · {run.status}
                        </div>
                        <div className="mt-2 text-2xl font-semibold">{run.title}</div>
                        <div className="mt-2 text-sm leading-6 text-[var(--paper)]">{run.lastMessage}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-semibold text-[var(--signal)]">{progress}%</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {runProgressLabel(progress)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/8">
                      <div className="h-full rounded-full bg-[var(--signal)]" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-[2.25rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Event ledger</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em]">Everything is reviewable</div>
            </div>
            <CheckCircle2 className="h-6 w-6 text-[var(--signal)]" />
          </div>
          <div className="mt-6 max-h-[38rem] space-y-3 overflow-y-auto pr-2">
            {events.length === 0 ? (
              <div className="rounded-[1.8rem] border border-[var(--line)] bg-black/20 p-5 text-sm leading-7 text-[var(--muted)]">
                Signals, intent decisions, streaming URLs, and receipts will appear here as soon as the first run starts.
              </div>
            ) : (
              events.map((event) => (
                <div key={event.id} className="rounded-[1.7rem] border border-[var(--line)] bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[var(--signal)]">
                        {event.phase}
                      </span>
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                      {event.progress}%
                    </span>
                  </div>
                  <div className="mt-3 text-sm leading-7 text-[var(--paper)]">{event.message}</div>
                  {event.signal ? (
                    <div className="mt-3 rounded-[1.3rem] border border-[var(--line)] bg-black/20 p-3 text-sm leading-6 text-[var(--paper)]">
                      Signal: {event.signal.instrument} · score {event.signal.score} · confidence{" "}
                      {formatPercent(event.signal.confidence * 100)}
                    </div>
                  ) : null}
                  {event.receipt ? (
                    <div className="mt-3 rounded-[1.3rem] border border-[var(--line)] bg-black/20 p-3 text-sm leading-6 text-[var(--paper)]">
                      Receipt: {event.receipt.venue.toUpperCase()} {event.receipt.status} · {formatCurrency(event.receipt.notionalUsd)}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-4 rounded-[2rem] border border-[var(--line)] bg-black/20 px-5 py-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CirclePause className="h-4 w-4 text-[var(--signal)]" />
          Demo auth is local by default. Clerk and Supabase env seams are documented for real persistence.
        </div>
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-[var(--signal)]" />
          Live routing stays gated behind explicit credential health and promotion controls.
        </div>
      </footer>
    </div>
  );
}
