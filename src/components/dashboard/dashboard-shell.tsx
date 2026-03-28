"use client";

import Link from "next/link";
import { useEffect, useDeferredValue, useRef, useState, useSyncExternalStore, useTransition } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Gauge,
  Globe2,
  KeyRound,
  LogOut,
  Play,
  Radar,
  RefreshCcw,
  ScrollText,
  Shield,
  Sparkles,
  TrendingUp,
  Waves,
  Workflow,
} from "lucide-react";
import { RECIPE_REGISTRY, buildSeedConnections, buildSeedPositions, buildSeedStrategies } from "@/lib/demo/mock-data";
import { assessConnection, getRecipeDefinition } from "@/lib/demo/engine";
import type {
  AgentEvent,
  ApprovalState,
  DemoUser,
  ExecutionMode,
  GeneratedStrategyResponse,
  Position,
  RecipeDefinition,
  RunLaunchResponse,
  RunRequest,
  RunSummary,
  StrategyVersion,
  Venue,
  VenueCandidate,
  VenueConnection,
} from "@/lib/demo/types";
import type { RuntimeStatusResponse } from "@/lib/runtime/types";

gsap.registerPlugin(ScrollTrigger);

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
  return `${value.toFixed(0)}%`;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "No runs yet";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function runProgressLabel(progress: number): string {
  if (progress < 14) return "boot";
  if (progress < 46) return "collect";
  if (progress < 74) return "review";
  if (progress < 94) return "decide";
  return "execute";
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

function upsertUnique<T>(
  items: T[],
  nextItem: T,
  getKey: (item: T) => string,
): T[] {
  const index = items.findIndex((item) => getKey(item) === getKey(nextItem));
  if (index === -1) return [nextItem, ...items];
  const copy = [...items];
  copy[index] = nextItem;
  return copy;
}

function consumeSse(url: string, onEvent: (event: AgentEvent) => void): Promise<void> {
  return fetch(url, { method: "GET", cache: "no-store" }).then(async (response) => {
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
  });
}

function targetVenues(recipe: RecipeDefinition, preferredVenue: VenueCandidate): Venue[] {
  if (preferredVenue === "both" || !preferredVenue) return recipe.supportedVenues;
  return recipe.supportedVenues.filter((venue) => venue === preferredVenue);
}

function toneForReadiness(readiness: RecipeDefinition["readiness"]): string {
  if (readiness === "live-ready") return "bg-emerald-500/14 text-emerald-200";
  if (readiness === "research") return "bg-amber-500/14 text-amber-200";
  return "bg-white/10 text-[var(--muted)]";
}

function toneForConnection(status: VenueConnection["status"]): string {
  if (status === "ready") return "bg-emerald-500/14 text-emerald-200";
  if (status === "warning") return "bg-amber-500/14 text-amber-200";
  return "bg-white/8 text-[var(--muted)]";
}

function toneForApproval(approvalState: ApprovalState): string {
  if (approvalState === "live-armed") return "bg-emerald-500/14 text-emerald-200";
  if (approvalState === "live-candidate") return "bg-amber-500/14 text-amber-200";
  return "bg-white/8 text-[var(--muted)]";
}

export function DashboardShell() {
  const rootRef = useRef<HTMLDivElement>(null);
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
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [launchSurface, setLaunchSurface] = useState<"recipe" | "agent">("recipe");
  const [launchMode, setLaunchMode] = useState<ExecutionMode>("paper");
  const [selectedRecipeId, setSelectedRecipeId] = useState(RECIPE_REGISTRY[0].id);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(RECIPE_REGISTRY[0].countries);
  const [selectedSources, setSelectedSources] = useState<string[]>(
    RECIPE_REGISTRY[0].sources.slice(0, 2).map((source) => source.id),
  );
  const [preferredVenue, setPreferredVenue] = useState<VenueCandidate>(RECIPE_REGISTRY[0].defaultVenueBias);
  const [objective, setObjective] = useState(
    "Generate a retail-safe thesis that hunts government policy lag, scores the signal, and routes the best instrument to paper first."
  );
  const deferredObjective = useDeferredValue(objective);
  const [riskProfile, setRiskProfile] = useState<DemoUser["riskProfile"]>(
    () => readLocalStorage<DemoUser | null>(USER_KEY, null)?.riskProfile ?? "balanced",
  );
  const [generated, setGenerated] = useState<GeneratedStrategyResponse["draft"] | null>(null);
  const [generatedReasoning, setGeneratedReasoning] = useState<string[]>([]);
  const [killSwitch, setKillSwitch] = useState(false);
  const [runError, setRunError] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusResponse | null>(null);
  const [isGenerating, startGenerating] = useTransition();
  const [isLaunching, setIsLaunching] = useState(false);

  const activeRecipe = getRecipeDefinition(selectedRecipeId);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const selectedRunEvents = selectedRun ? events.filter((event) => event.runId === selectedRun.id) : [];

  useEffect(() => {
    if (!rootRef.current) return;

    const context = gsap.context(() => {
      gsap.from(".cockpit-reveal", {
        y: 28,
        opacity: 0,
        duration: 0.8,
        stagger: 0.08,
        ease: "power3.out",
      });

      gsap.from(".section-reveal", {
        scrollTrigger: {
          trigger: ".section-reveal",
          start: "top 78%",
        },
        y: 36,
        opacity: 0,
        duration: 0.85,
        stagger: 0.12,
        ease: "power3.out",
      });
    }, rootRef);

    return () => context.revert();
  }, []);

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
    setSelectedCountries(activeRecipe.countries);
    setSelectedSources(activeRecipe.sources.slice(0, 2).map((source) => source.id));
    setPreferredVenue(
      activeRecipe.supportedVenues.length === 1 ? activeRecipe.supportedVenues[0] : activeRecipe.defaultVenueBias,
    );
  }, [activeRecipe]);

  useEffect(() => {
    if (!selectedRunId && runs[0]) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    let active = true;

    fetch("/api/runtime/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as RuntimeStatusResponse;
      })
      .then((payload) => {
        if (!active || !payload) return;
        setRuntimeStatus(payload);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const interval = window.setInterval(() => {
      setPositions((current) =>
        current.map((position, index) => {
          if (position.status !== "open") return position;
          const direction = index % 2 === 0 ? 1 : -1;
          const basisMove = position.venue === "ibkr" ? 0.11 : 0.01;
          const nextMark = Number((position.markPrice + direction * basisMove).toFixed(position.venue === "ibkr" ? 2 : 3));
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

  function recordEvent(event: AgentEvent) {
    setEvents((current) => [event, ...current].slice(0, 90));
    setRuns((current) => {
      const runIndex = current.findIndex((run) => run.id === event.runId);
      if (runIndex === -1) return current;

      const existing = current[runIndex];
      const nextRun: RunSummary = {
        ...existing,
        progress: event.progress,
        phase: event.phase,
        lastMessage: event.message,
        streamingUrl:
          typeof event.meta?.streaming_url === "string" ? event.meta.streaming_url : existing.streamingUrl,
        status:
          event.phase === "BLOCKED"
            ? "blocked"
            : event.phase === "COMPLETE"
              ? existing.status === "blocked"
                ? "blocked"
                : "complete"
              : "running",
        completedAt: event.phase === "COMPLETE" ? event.timestamp : existing.completedAt,
        rawSignals: event.rawSignal
          ? upsertUnique(existing.rawSignals, event.rawSignal, (item) => item.fingerprint).slice(0, 8)
          : existing.rawSignals,
        reviewedSignals: event.reviewedSignal
          ? upsertUnique(existing.reviewedSignals, event.reviewedSignal, (item) => item.fingerprint).slice(0, 8)
          : existing.reviewedSignals,
        intents: event.intent
          ? upsertUnique(existing.intents, event.intent, (item) => `${item.reviewFingerprint}:${item.venue}`).slice(0, 6)
          : existing.intents,
        receipts: event.receipt
          ? upsertUnique(existing.receipts, event.receipt, (item) => item.receiptId).slice(0, 6)
          : existing.receipts,
        fallbackState:
          event.phase === "BLOCKED"
            ? "blocked"
            : event.meta?.fallback_state === "empty"
              ? "empty"
              : existing.fallbackState,
      };

      const copy = [...current];
      copy[runIndex] = nextRun;
      return copy;
    });

    if (event.receipt && event.position && event.receipt.status !== "preview") {
      const nextPosition = event.position;
      setPositions((current) => {
        const existingIndex = current.findIndex(
          (item) =>
            item.symbolOrToken === nextPosition.symbolOrToken &&
            item.venue === nextPosition.venue,
        );
        if (existingIndex === -1) return [nextPosition, ...current].slice(0, 14);
        const copy = [...current];
        copy[existingIndex] = nextPosition;
        return copy;
      });
    }

    if (event.phase === "COMPLETE") {
      setStrategies((current) =>
        current.map((strategy) =>
          strategy.id === event.strategyId
            ? {
                ...strategy,
                lastRunSummary: event.message,
              }
            : strategy,
        ),
      );
    }
  }

  if (!hydrated) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-7xl items-center justify-center px-5 py-16 sm:px-8">
        <div className="rounded-[2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-8 py-6 text-lg text-[var(--muted)]">
          Loading overview cockpit...
        </div>
      </div>
    );
  }

  const runtimeManagedConnections = Boolean(runtimeStatus && runtimeStatus.mode !== "demo");
  const effectiveConnections =
    runtimeManagedConnections && runtimeStatus ? runtimeStatus.connections : connections;
  const readyConnections = effectiveConnections.filter((connection) => connection.status === "ready").length;
  const liveWarnings = effectiveConnections.filter(
    (connection) => connection.mode === "live" && connection.status === "warning",
  ).length;
  const totalExposure = positions.reduce((sum, position) => sum + position.markPrice * position.quantity, 0);
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (position.markPrice - position.entryPrice) * position.quantity,
    0,
  );
  const activityPreview = selectedRunEvents.slice(0, 6);
  const selectedReview = selectedRun?.reviewedSignals[0] ?? null;
  const activeVenues = targetVenues(activeRecipe, preferredVenue);
  const launchConnections = activeVenues
    .map((venue) => effectiveConnections.find((connection) => connection.venue === venue && connection.mode === launchMode))
    .filter((connection): connection is VenueConnection => Boolean(connection));
  const liveLaunchBlocked =
    launchMode === "live" &&
    (activeRecipe.readiness !== "live-ready" ||
      launchConnections.some((connection) => connection.status === "missing"));
  const liveLaunchWarning =
    launchMode === "live" &&
    !liveLaunchBlocked &&
    launchConnections.some((connection) => connection.status === "warning");

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

  function toggleCountry(country: string) {
    setSelectedCountries((current) =>
      current.includes(country)
        ? current.filter((entry) => entry !== country)
        : [...current, country],
    );
  }

  function toggleSource(sourceId: string) {
    setSelectedSources((current) =>
      current.includes(sourceId)
        ? current.filter((entry) => entry !== sourceId)
        : [...current, sourceId],
    );
  }

  function signOut() {
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  function focusLaunch(surface: "recipe" | "agent") {
    setLaunchSurface(surface);
    document.getElementById("launch-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function launchRequest(request: Partial<RunRequest>, label: string) {
    if (killSwitch) {
      setRunError("Kill switch is active. Disable it before launching a new run.");
      return;
    }

    setRunError("");
    setIsLaunching(true);

    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Run launch failed with ${response.status}`);
      }

      const launch = (await response.json()) as RunLaunchResponse;
      setSelectedRunId(launch.runId);
      const nextRun: RunSummary = {
        id: launch.runId,
        label,
        request: launch.request,
        recipeId: launch.request.recipeId,
        strategyId: launch.request.strategyId,
        mode: launch.request.mode,
        status: "running",
        progress: 0,
        phase: "STARTED",
        startedAt: new Date().toISOString(),
        lastMessage: "Queued for stream startup...",
        streamingUrl: launch.streamingUrl,
        rawSignals: [],
        reviewedSignals: [],
        intents: [],
        receipts: [],
        runtimeMode: launch.runtimeMode,
      };
      setRuns((current) => [nextRun, ...current].slice(0, 12));

      await consumeSse(launch.streamUrl, recordEvent);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLaunching(false);
    }
  }

  async function launchRecipeRun() {
    if (selectedSources.length === 0) {
      setRunError("Select at least one source before running a recipe.");
      return;
    }

    if (launchMode === "live") {
      if (liveLaunchBlocked) {
        setRunError(
          activeRecipe.readiness !== "live-ready"
            ? `${activeRecipe.title} is ${activeRecipe.readiness}. Keep it in paper for now.`
            : "Live routing is missing one or more required venue credentials.",
        );
        return;
      }

      const proceed = window.confirm(
        `${activeRecipe.title} will route in live mode. Confirm that preflight is acceptable and you want to continue.`,
      );
      if (!proceed) return;
    }

    await launchRequest(
      {
        recipeId: activeRecipe.id,
        countries: selectedCountries,
        sources: selectedSources,
        skills: activeRecipe.suggestedSkills,
        mode: launchMode,
        execute: true,
        previewOnly: false,
        force: true,
        promptVersion: activeRecipe.promptVersion,
        preferredVenue,
      },
      activeRecipe.title,
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

      if (!response.ok) {
        setRunError(`Draft generation failed with ${response.status}`);
        return;
      }

      const payload = (await response.json()) as GeneratedStrategyResponse;
      setGenerated(payload.draft);
      setGeneratedReasoning(payload.reasoning);
      setLaunchSurface("agent");
    });
  }

  function saveGeneratedStrategy() {
    if (!generated) return;
    const recipe = getRecipeDefinition(generated.runConfig.recipeId);

    const nextStrategy: StrategyVersion = {
      ...generated,
      version: 1,
      guardrails: recipe.guardrails,
      readiness: recipe.readiness,
      lastRunSummary: "Draft saved. No runs yet.",
    };

    setStrategies((current) => [nextStrategy, ...current]);
    setGenerated(null);
    setGeneratedReasoning([]);
  }

  async function runGeneratedDraft() {
    if (!generated) return;
    await launchRequest(
      {
        ...generated.runConfig,
        strategyId: generated.id,
        strategyBrief: generated.objective,
        mode: "paper",
      },
      generated.name,
    );
  }

  function toggleStrategyApproval(strategyId: string) {
    setStrategies((current) =>
      current.map((strategy) => {
        if (strategy.id !== strategyId) return strategy;
        if (strategy.readiness !== "live-ready") {
          setRunError(`${strategy.name} is ${strategy.readiness}. Keep it on paper.`);
          return strategy;
        }

        const nextApproval =
          strategy.approvalState === "live-armed" ? "paper" : "live-armed";

        return {
          ...strategy,
          approvalState: nextApproval,
          runConfig: {
            ...strategy.runConfig,
            mode: nextApproval === "live-armed" ? "live" : "paper",
          },
        };
      }),
    );
  }

  async function runStrategy(strategy: StrategyVersion) {
    if (strategy.runConfig.mode === "live") {
      const recipe = getRecipeDefinition(strategy.runConfig.recipeId);
      const strategyVenues = targetVenues(recipe, strategy.runConfig.preferredVenue ?? recipe.defaultVenueBias);
      const blocked = strategyVenues.some((venue) =>
        effectiveConnections.some(
          (connection) =>
            connection.venue === venue &&
            connection.mode === "live" &&
            connection.status === "missing",
        ),
      );

      if (blocked) {
        setRunError("Live routing is missing one or more required venue credentials.");
        return;
      }

      const proceed = window.confirm(
        `${strategy.name} is armed for live routing. Continue?`,
      );
      if (!proceed) return;
    }

    await launchRequest(
      {
        ...strategy.runConfig,
        strategyId: strategy.id,
        strategyBrief: strategy.objective,
      },
      strategy.name,
    );
  }

  return (
    <div ref={rootRef} className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(230,59,46,0.2),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(116,160,255,0.12),_transparent_34%)]" />

      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-8 px-4 py-6 sm:px-6 xl:px-8">
        <header className="cockpit-reveal flex items-center justify-between rounded-full border border-[var(--line)] bg-black/25 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,255,255,0.16)] bg-[var(--signal)] text-xs font-bold uppercase tracking-[0.2em] text-black">
              TF
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Retail investor cockpit</div>
              <div className="text-sm font-medium text-[var(--paper)]">tinyfish-remora</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/" className="hidden rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--paper)] sm:inline-flex">
              Landing
            </Link>
            {user ? (
              <button className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--paper)]" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                {user.name}
              </button>
            ) : (
              <Link href="/auth" className="rounded-full bg-[var(--signal)] px-4 py-2 text-sm font-semibold text-black">
                Demo sign in
              </Link>
            )}
          </div>
        </header>

        <section className="cockpit-reveal relative min-h-[calc(100dvh-8rem)] overflow-hidden rounded-[2.8rem] border border-[var(--line)] bg-[rgba(7,7,8,0.72)] p-5 shadow-[0_38px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
          <div className="pointer-events-none absolute inset-0 opacity-60">
            <div className="absolute left-0 top-0 h-60 w-60 rounded-full bg-[rgba(230,59,46,0.18)] blur-3xl" />
            <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-[rgba(70,110,210,0.12)] blur-3xl" />
          </div>

          <div className="relative grid gap-8 xl:grid-cols-[0.88fr_1.12fr] xl:items-stretch">
            <div className="flex flex-col justify-between gap-8">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-3 rounded-full border border-[rgba(230,59,46,0.28)] bg-[rgba(230,59,46,0.1)] px-4 py-2 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                  <Radar className="h-4 w-4 text-[var(--signal)]" />
                  Streaming government scans and agent theses
                </div>

                <div>
                  <div className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Brand-first overview cockpit</div>
                  <h1 className="mt-4 font-[var(--font-display)] text-[clamp(4.4rem,12vw,8rem)] leading-[0.86] tracking-[-0.05em] text-[var(--paper)]">
                    tinyfish-remora
                  </h1>
                  <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)] sm:text-xl">
                    Run proven government recipes or let the agent produce a fresh trading thesis,
                    then watch the exact collect-review-decide-execute loop before paper or live routing.
                  </p>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="inline-flex rounded-full border border-[var(--line)] bg-black/25 p-1">
                    <button
                      className={`rounded-full px-5 py-2 text-sm ${launchMode === "paper" ? "bg-[var(--paper)] font-semibold text-black" : "text-[var(--muted)]"}`}
                      onClick={() => setLaunchMode("paper")}
                    >
                      Paper
                    </button>
                    <button
                      className={`rounded-full px-5 py-2 text-sm ${launchMode === "live" ? "bg-[var(--signal)] font-semibold text-black" : "text-[var(--muted)]"}`}
                      onClick={() => setLaunchMode("live")}
                    >
                      Live
                    </button>
                  </div>

                  <div className="inline-flex items-center gap-3 rounded-full border border-[var(--line)] bg-black/25 px-4 py-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    <span className={`h-2.5 w-2.5 rounded-full ${killSwitch ? "bg-rose-400" : "bg-emerald-400 live-pulse"}`} />
                    {killSwitch ? "Kill switch active" : "Routing armed"}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button className="primary-button w-full justify-center" onClick={() => focusLaunch("recipe")}>
                    Run Recipe
                    <Play className="h-4 w-4" />
                  </button>
                  <button className="secondary-button w-full justify-center" onClick={() => focusLaunch("agent")}>
                    Ask Agent
                    <Bot className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-[2rem] border border-[var(--line)] bg-[linear-gradient(150deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01))] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Current run state</div>
                      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--paper)]">
                        {selectedRun?.label ?? "No active run"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-semibold text-[var(--signal)]">
                        {selectedRun?.progress ?? 0}%
                      </div>
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                        {runProgressLabel(selectedRun?.progress ?? 0)}
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-[var(--paper)]">
                    {selectedRun?.lastMessage ??
                      "Recipe launches and agent drafts both stream here with identical event shapes."}
                  </p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="progress-beam h-full rounded-full bg-[var(--signal)]"
                      style={{ width: `${selectedRun?.progress ?? 0}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-[2rem] border border-[var(--line)] bg-black/25 px-5 py-4">
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      {
                        label: "Open P&L",
                        value: formatCurrency(unrealizedPnl),
                        tone: unrealizedPnl >= 0 ? "text-emerald-300" : "text-rose-300",
                      },
                      {
                        label: "Exposure",
                        value: formatCurrency(totalExposure),
                        tone: "text-[var(--paper)]",
                      },
                      {
                        label: "Ready venues",
                        value: `${readyConnections}/4`,
                        tone: "text-[var(--paper)]",
                      },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{metric.label}</div>
                        <div className={`mt-2 text-2xl font-semibold ${metric.tone}`}>{metric.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
                    <span>{liveWarnings} live venue warning{liveWarnings === 1 ? "" : "s"}</span>
                    <button className="inline-flex items-center gap-2 text-[var(--paper)]" onClick={() => setKillSwitch((current) => !current)}>
                      <Shield className="h-4 w-4 text-[var(--signal)]" />
                      {killSwitch ? "Resume routing" : "Pause routing"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2.4rem] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(15,17,22,0.92),rgba(8,8,10,0.82))] p-6">
              <div className="absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(230,59,46,0.14),transparent)]" />
              <div className="relative flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Live activity plane</div>
                    <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--paper)]">
                      {selectedRun?.label ?? "Awaiting launch"}
                    </div>
                  </div>
                  <div className="rounded-full border border-[var(--line)] bg-black/25 px-4 py-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    {selectedRun?.mode ?? launchMode} · {selectedRun?.status ?? "idle"} · {selectedRun?.runtimeMode ?? runtimeStatus?.mode ?? "demo"}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                  <div className="space-y-4 rounded-[1.8rem] border border-[var(--line)] bg-black/20 p-5">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                      <span>Replay + launch scope</span>
                      <span>{selectedRun ? formatTimestamp(selectedRun.startedAt) : "Idle"}</span>
                    </div>
                    <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/35 px-4 py-3 text-sm leading-7 text-[var(--paper)]">
                      {selectedRun?.streamingUrl ?? "A TinyFish replay URL appears here when the next run starts."}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/25 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Countries</div>
                        <div className="mt-2 text-base text-[var(--paper)]">
                          {selectedRun?.request.countries?.join(", ") ?? selectedCountries.join(", ")}
                        </div>
                      </div>
                      <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/25 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Prompt version</div>
                        <div className="mt-2 text-base text-[var(--paper)]">
                          {selectedRun?.request.promptVersion ?? activeRecipe.promptVersion}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/25 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Reviewed</div>
                        <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">
                          {selectedRun?.reviewedSignals.length ?? 0}
                        </div>
                      </div>
                      <div className="rounded-[1.4rem] border border-[var(--line)] bg-black/25 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Receipts</div>
                        <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">
                          {selectedRun?.receipts.length ?? 0}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.8rem] border border-[var(--line)] bg-black/24 p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Streaming ledger</div>
                      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 live-pulse" />
                        {selectedRun ? selectedRun.phase : "Idle"}
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {activityPreview.length === 0 ? (
                        <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/20 p-4 text-sm leading-7 text-[var(--muted)]">
                          Launch a recipe or an agent draft to populate the live stream, scored review, and receipts in one place.
                        </div>
                      ) : (
                        activityPreview.map((event, index) => (
                          <div
                            key={event.id}
                            className={`rounded-[1.5rem] border border-[var(--line)] bg-black/20 p-4 ${index === 0 ? "event-glow" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
                                {event.phase}
                              </span>
                              <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                                {formatTimestamp(event.timestamp)}
                              </span>
                            </div>
                            <div className="mt-3 text-sm leading-7 text-[var(--paper)]">{event.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {runError ? (
          <div className="cockpit-reveal rounded-[1.7rem] border border-[rgba(230,59,46,0.3)] bg-[rgba(230,59,46,0.1)] px-5 py-4 text-sm text-[var(--paper)]">
            {runError}
          </div>
        ) : null}

        {runtimeStatus ? (
          <div className="cockpit-reveal rounded-[1.7rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-5 py-4">
            <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Runtime mode</div>
            <div className="mt-2 text-sm leading-7 text-[var(--paper)]">
              {runtimeStatus.mode === "demo"
                ? "Demo fallback is active. TinyFish, review, and execution continue to run locally until gateway env vars are configured."
                : runtimeStatus.mode === "hybrid"
                  ? "Hybrid runtime is active. Some providers are env-backed and the rest still fall back to the local demo engine."
                  : "Live runtime is active. TinyFish, review, and execution routes are all env-backed."}
            </div>
            {runtimeStatus.warnings.slice(0, 2).map((warning) => (
              <div key={warning} className="mt-2 text-xs leading-6 text-[var(--muted)]">
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        <section className="section-reveal grid gap-5 lg:grid-cols-[0.84fr_1.16fr]">
          <div className="rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Overview</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                  Venue health and exposure
                </div>
              </div>
              <Gauge className="h-6 w-6 text-[var(--signal)]" />
            </div>
            <div className="mt-6 space-y-4">
              {effectiveConnections.map((connection) => (
                <div key={connection.id} className="rounded-[1.8rem] border border-[var(--line)] bg-black/18 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{connection.mode}</div>
                      <div className="mt-1 text-xl font-semibold text-[var(--paper)]">{connection.label}</div>
                      <div className="mt-1 text-sm text-[var(--muted)]">{connection.statusNote}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.22em] ${toneForConnection(connection.status)}`}>
                      {connection.status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {Object.entries(connection.fields).map(([field, value]) => (
                      <label key={field} className="space-y-2">
                        <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">{field}</span>
                        <input
                          className="input-shell"
                          value={value}
                          onChange={(event) => updateConnectionField(connection.id, field, event.target.value)}
                          readOnly={runtimeManagedConnections}
                          type={field.toLowerCase().includes("key") || field.toLowerCase().includes("secret") ? "password" : "text"}
                        />
                        {value ? (
                          <span className="text-xs text-[var(--muted)]">Stored as {maskValue(value)}</span>
                        ) : null}
                        {runtimeManagedConnections ? (
                          <span className="text-xs text-[var(--muted)]">Managed by server environment.</span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Open positions</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                  P&amp;L stays attributable
                </div>
              </div>
              <TrendingUp className="h-6 w-6 text-[var(--signal)]" />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                {
                  label: "Gross exposure",
                  value: formatCurrency(totalExposure),
                  note: "Across paper and live-marked open positions.",
                },
                {
                  label: "Unrealized P&L",
                  value: formatCurrency(unrealizedPnl),
                  note: "Marks update continuously in demo mode.",
                },
                {
                  label: "Open positions",
                  value: `${positions.length}`,
                  note: "Each position retains its originating strategy.",
                },
              ].map((card) => (
                <div key={card.label} className="rounded-[1.7rem] border border-[var(--line)] bg-black/18 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{card.label}</div>
                  <div className="mt-2 text-3xl font-semibold text-[var(--paper)]">{card.value}</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--muted)]">{card.note}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 overflow-hidden rounded-[1.8rem] border border-[var(--line)]">
              <div className="grid grid-cols-[1.1fr_1fr_0.7fr_0.7fr_0.8fr] gap-3 bg-black/26 px-4 py-3 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
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
                    className="grid grid-cols-[1.1fr_1fr_0.7fr_0.7fr_0.8fr] gap-3 border-t border-[var(--line)] px-4 py-3 text-sm"
                  >
                    <div>
                      <div className="font-semibold text-[var(--paper)]">{position.symbolOrToken}</div>
                      <div className="text-xs text-[var(--muted)]">{position.venue} · {position.mode}</div>
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
        </section>

        <section id="launch-section" className="section-reveal rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Launch</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                Recipe execution and agent drafting
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted)]">
                One run contract now carries recipe identity, source scope, countries, prompt version,
                and venue intent through launch, streaming, review, and execution.
              </p>
            </div>

            <div className="inline-flex rounded-full border border-[var(--line)] bg-black/25 p-1">
              <button
                className={`rounded-full px-4 py-2 text-sm ${launchSurface === "recipe" ? "bg-[var(--signal)] font-semibold text-black" : "text-[var(--muted)]"}`}
                onClick={() => setLaunchSurface("recipe")}
              >
                Run Recipe
              </button>
              <button
                className={`rounded-full px-4 py-2 text-sm ${launchSurface === "agent" ? "bg-[var(--paper)] font-semibold text-black" : "text-[var(--muted)]"}`}
                onClick={() => setLaunchSurface("agent")}
              >
                Ask Agent
              </button>
            </div>
          </div>

          {launchSurface === "recipe" ? (
            <div className="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[2rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Recipe registry</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">{activeRecipe.title}</div>
                    <div className="mt-1 text-sm text-[var(--muted)]">{activeRecipe.subtitle}</div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.22em] ${toneForReadiness(activeRecipe.readiness)}`}>
                    {activeRecipe.readiness}
                  </span>
                </div>

                <p className="mt-4 text-sm leading-7 text-[var(--paper)]">{activeRecipe.description}</p>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {[
                    {
                      label: "Evidence",
                      value: `${activeRecipe.evidenceCount}`,
                      note: "successful proof runs",
                    },
                    {
                      label: "Sample signals",
                      value: `${activeRecipe.sampleSignalCount}`,
                      note: "recorded in registry",
                    },
                    {
                      label: "Last success",
                      value: formatTimestamp(activeRecipe.lastSuccessfulRunAt),
                      note: "latest healthy run",
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</div>
                      <div className="mt-2 text-lg font-semibold text-[var(--paper)]">{item.value}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{item.note}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 space-y-3">
                  {RECIPE_REGISTRY.map((recipe) => (
                    <button
                      type="button"
                      key={recipe.id}
                      className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${recipe.id === selectedRecipeId ? "border-[rgba(230,59,46,0.38)] bg-[rgba(230,59,46,0.09)]" : "border-[var(--line)] bg-black/20"}`}
                      onClick={() => setSelectedRecipeId(recipe.id)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{recipe.category}</div>
                          <div className="mt-1 text-xl font-semibold text-[var(--paper)]">{recipe.title}</div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] ${toneForReadiness(recipe.readiness)}`}>
                          {recipe.readiness}
                        </span>
                      </div>
                      <div className="mt-3 text-sm leading-7 text-[var(--muted)]">{recipe.strategyOutline}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Run scope</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">Countries, sources, and venue path</div>
                  </div>
                  <Workflow className="h-6 w-6 text-[var(--signal)]" />
                </div>

                <div className="mt-6 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Countries</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeRecipe.countries.map((country) => (
                          <button
                            key={country}
                            className={`rounded-full border px-3 py-1.5 text-sm ${selectedCountries.includes(country) ? "border-[rgba(230,59,46,0.4)] bg-[rgba(230,59,46,0.1)] text-[var(--paper)]" : "border-[var(--line)] text-[var(--muted)]"}`}
                            onClick={() => toggleCountry(country)}
                          >
                            {country}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Sources</div>
                      <div className="mt-3 space-y-3">
                        {activeRecipe.sources.map((source) => (
                          <button
                            type="button"
                            key={source.id}
                            className={`w-full rounded-[1.4rem] border px-4 py-3 text-left ${selectedSources.includes(source.id) ? "border-[rgba(230,59,46,0.38)] bg-[rgba(230,59,46,0.08)]" : "border-[var(--line)] bg-black/18"}`}
                            onClick={() => toggleSource(source.id)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-[var(--paper)]">{source.name}</div>
                                <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{source.country} · {source.locale}</div>
                              </div>
                              <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] ${source.status === "healthy" ? "bg-emerald-500/12 text-emerald-200" : "bg-amber-500/12 text-amber-200"}`}>
                                {source.status}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[1.6rem] border border-[var(--line)] bg-black/22 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Supported venues</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {["both", ...activeRecipe.supportedVenues].map((option) => {
                          const disabled = option !== "both" && !activeRecipe.supportedVenues.includes(option as Venue);
                          return (
                            <button
                              key={option}
                              className={`rounded-full border px-3 py-1.5 text-sm ${preferredVenue === option ? "border-[rgba(230,59,46,0.4)] bg-[rgba(230,59,46,0.1)] text-[var(--paper)]" : "border-[var(--line)] text-[var(--muted)]"} ${disabled ? "opacity-40" : ""}`}
                              disabled={disabled}
                              onClick={() => setPreferredVenue(option as VenueCandidate)}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 text-sm leading-7 text-[var(--muted)]">
                        Add a new country by extending the recipe registry with source definitions and prompt versioning, not by wiring new UI-only branches.
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-[var(--line)] bg-black/22 p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Prompt version</div>
                          <div className="mt-2 text-lg font-semibold text-[var(--paper)]">{activeRecipe.promptVersion}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Scoring model</div>
                          <div className="mt-2 text-lg font-semibold text-[var(--paper)]">{activeRecipe.scoringModel}</div>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2 text-sm leading-7 text-[var(--paper)]">
                        {activeRecipe.guardrails.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[1.6rem] border border-[var(--line)] bg-black/22 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Known failure modes</div>
                      <div className="mt-3 space-y-2 text-sm leading-7 text-[var(--paper)]">
                        {activeRecipe.knownFailureModes.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    </div>

                    {launchMode === "live" ? (
                      <div className={`rounded-[1.6rem] border px-4 py-4 text-sm ${liveLaunchBlocked ? "border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.08)] text-rose-100" : liveLaunchWarning ? "border-[rgba(245,158,11,0.28)] bg-[rgba(245,158,11,0.08)] text-amber-100" : "border-[rgba(52,211,153,0.24)] bg-[rgba(52,211,153,0.08)] text-emerald-100"}`}>
                        {liveLaunchBlocked
                          ? "Live preflight is blocked. This recipe is not live-ready or a required venue credential is missing."
                          : liveLaunchWarning
                            ? "Live preflight is yellow. Credentials exist, but at least one venue still needs operator review."
                            : "Live preflight is green enough for an operator-confirmed launch."}
                      </div>
                    ) : null}

                    <button className="primary-button w-full justify-center" onClick={launchRecipeRun} disabled={isLaunching}>
                      {isLaunching ? "Launching..." : launchMode === "live" ? "Launch Live Run" : "Launch Paper Run"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 xl:grid-cols-[0.98fr_1.02fr]">
              <div className="rounded-[2rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Agent brief</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">Generate a fresh thesis</div>
                  </div>
                  <Bot className="h-6 w-6 text-[var(--signal)]" />
                </div>

                <div className="mt-6 grid gap-4">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Objective</span>
                    <textarea
                      className="input-shell min-h-36 resize-none"
                      value={objective}
                      onChange={(event) => setObjective(event.target.value)}
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Risk</span>
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
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Venue bias</span>
                      <select
                        className="input-shell"
                        value={preferredVenue}
                        onChange={(event) => setPreferredVenue(event.target.value as VenueCandidate)}
                      >
                        <option value="both">Both</option>
                        <option value="ibkr">IBKR</option>
                        <option value="polymarket">Polymarket</option>
                      </select>
                    </label>
                    <div className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Action</span>
                      <button className="primary-button w-full justify-center" onClick={generateStrategy}>
                        {isGenerating ? "Generating..." : "Generate Draft"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-[1.6rem] border border-[var(--line)] bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Live objective preview</div>
                  <div className="mt-2 text-base leading-7 text-[var(--paper)]">
                    {deferredObjective}
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Draft output</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">
                      {generated?.name ?? "Awaiting draft"}
                    </div>
                  </div>
                  <Sparkles className="h-6 w-6 text-[var(--signal)]" />
                </div>

                {generated ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-[1.6rem] border border-[rgba(230,59,46,0.28)] bg-[rgba(230,59,46,0.08)] p-4">
                      <div className="text-sm leading-7 text-[var(--paper)]">{generated.thesis}</div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {generated.promptVersion}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.22em] ${toneForApproval(generated.approvalState)}`}>
                          {generated.approvalState}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {generated.scorecard.map((item) => (
                        <div key={item.label} className="rounded-[1.4rem] border border-[var(--line)] bg-black/22 p-4">
                          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{item.label}</div>
                          <div className="mt-2 text-3xl font-semibold text-[var(--signal)]">{item.score}</div>
                          <div className="mt-2 text-sm leading-6 text-[var(--paper)]">{item.note}</div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Generated run config</div>
                        <div className="mt-3 space-y-2 text-sm leading-7 text-[var(--paper)]">
                          <div>Recipe: {getRecipeDefinition(generated.runConfig.recipeId).title}</div>
                          <div>Countries: {generated.runConfig.countries?.join(", ")}</div>
                          <div>Sources: {generated.runConfig.sources?.join(", ")}</div>
                          <div>Venue bias: {generated.runConfig.preferredVenue}</div>
                        </div>
                      </div>
                      <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Scoring rationale</div>
                        <div className="mt-3 space-y-2 text-sm leading-7 text-[var(--paper)]">
                          {generatedReasoning.map((line) => (
                            <div key={line}>{line}</div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button className="secondary-button justify-center" onClick={saveGeneratedStrategy}>
                        Save Draft
                      </button>
                      <button className="primary-button justify-center" onClick={runGeneratedDraft}>
                        Run Paper Preview
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-[1.6rem] border border-[var(--line)] bg-black/20 p-5 text-sm leading-7 text-[var(--muted)]">
                    The draft output will include a rerunnable run config, venue mapping, scorecard,
                    and a paper-first approval state.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="section-reveal grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
          <div className="rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Activity</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                  Run board
                </div>
              </div>
              <Waves className="h-6 w-6 text-[var(--signal)]" />
            </div>

            <div className="mt-6 space-y-4">
              {runs.length === 0 ? (
                <div className="rounded-[1.7rem] border border-[var(--line)] bg-black/18 p-5 text-sm leading-7 text-[var(--muted)]">
                  No runs yet. Launch a recipe or generated draft to populate the run board and event ledger.
                </div>
              ) : (
                runs.map((run) => (
                  <button
                    type="button"
                    key={run.id}
                    className={`w-full rounded-[1.7rem] border px-5 py-4 text-left ${selectedRun?.id === run.id ? "border-[rgba(230,59,46,0.38)] bg-[rgba(230,59,46,0.08)]" : "border-[var(--line)] bg-black/18"}`}
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                          {run.mode} · {run.status} · {run.runtimeMode ?? runtimeStatus?.mode ?? "demo"} · {runProgressLabel(run.progress)}
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">{run.label}</div>
                        <div className="mt-2 text-sm leading-6 text-[var(--paper)]">{run.lastMessage}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-semibold text-[var(--signal)]">{run.progress}%</div>
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{formatTimestamp(run.startedAt)}</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Event ledger</div>
                <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                  Reviewable from stream to receipt
                </div>
              </div>
              <ScrollText className="h-6 w-6 text-[var(--signal)]" />
            </div>

            <div className="mt-6 max-h-[48rem] space-y-3 overflow-y-auto pr-2">
              {selectedRunEvents.length === 0 ? (
                <div className="rounded-[1.7rem] border border-[var(--line)] bg-black/18 p-5 text-sm leading-7 text-[var(--muted)]">
                  Select a run to inspect every stream, review, decision, and receipt event.
                </div>
              ) : (
                selectedRunEvents.map((event) => (
                  <div key={event.id} className="rounded-[1.6rem] border border-[var(--line)] bg-black/18 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[var(--signal)]">
                          {event.phase}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                          {formatTimestamp(event.timestamp)}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                        {event.progress}%
                      </span>
                    </div>
                    <div className="mt-3 text-sm leading-7 text-[var(--paper)]">{event.message}</div>
                    {event.meta?.streaming_url ? (
                      <div className="mt-3 rounded-[1.3rem] border border-[var(--line)] bg-black/22 p-3 text-xs leading-6 text-[var(--muted)]">
                        Replay URL: {String(event.meta.streaming_url)}
                      </div>
                    ) : null}
                    {event.rawSignal ? (
                      <div className="mt-3 rounded-[1.3rem] border border-[var(--line)] bg-black/22 p-3 text-sm leading-6 text-[var(--paper)]">
                        Raw signal: {event.rawSignal.source} · {event.rawSignal.country} · {event.rawSignal.title}
                      </div>
                    ) : null}
                    {event.reviewedSignal ? (
                      <div className="mt-3 rounded-[1.3rem] border border-[var(--line)] bg-black/22 p-3 text-sm leading-6 text-[var(--paper)]">
                        Reviewed: {event.reviewedSignal.reviewScore}/100 · {formatPercent(event.reviewedSignal.confidence * 100)}
                      </div>
                    ) : null}
                    {event.receipt ? (
                      <div className="mt-3 rounded-[1.3rem] border border-[var(--line)] bg-black/22 p-3 text-sm leading-6 text-[var(--paper)]">
                        Receipt: {event.receipt.venue.toUpperCase()} {event.receipt.status} · {formatCurrency(event.receipt.notionalUsd)}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="section-reveal rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Review</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                Scored signals, instruments, and receipts
              </div>
            </div>
            <CheckCircle2 className="h-6 w-6 text-[var(--signal)]" />
          </div>

          {selectedRun ? (
            <div className="mt-6 grid gap-5 xl:grid-cols-[0.8fr_1fr_0.9fr]">
              <div className="rounded-[1.8rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Raw signals</div>
                <div className="mt-4 space-y-3">
                  {selectedRun.rawSignals.length === 0 ? (
                    <div className="text-sm leading-7 text-[var(--muted)]">No raw signals recorded for this run.</div>
                  ) : (
                    selectedRun.rawSignals.map((signal) => (
                      <div key={signal.fingerprint} className="rounded-[1.4rem] border border-[var(--line)] bg-black/22 p-4">
                        <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{signal.country} · {signal.language}</div>
                        <div className="mt-2 text-base font-semibold text-[var(--paper)]">{signal.title}</div>
                        <div className="mt-2 text-sm leading-6 text-[var(--muted)]">{signal.summary}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[1.8rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Reviewed signal</div>
                {selectedReview ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[1.5rem] border border-[rgba(230,59,46,0.28)] bg-[rgba(230,59,46,0.08)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="text-base font-semibold text-[var(--paper)]">{selectedReview.title}</div>
                          <div className="mt-2 text-sm leading-7 text-[var(--paper)]">{selectedReview.thesis}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-semibold text-[var(--signal)]">{selectedReview.reviewScore}</div>
                          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">review score</div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Instrument mapping</div>
                      <div className="mt-3 space-y-3">
                        {selectedReview.instrumentCandidates.map((instrument) => (
                          <div key={`${instrument.venue}-${instrument.symbolOrToken}`} className="rounded-[1.3rem] border border-[var(--line)] bg-black/22 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-[var(--paper)]">{instrument.label}</div>
                                <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{instrument.venue}</div>
                              </div>
                              <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                                {instrument.sideHint ?? "buy"}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Review rationale</div>
                      <div className="mt-3 text-sm leading-7 text-[var(--paper)]">
                        {selectedReview.reasoning}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-sm leading-7 text-[var(--muted)]">
                    No reviewed signal exists for this run yet.
                  </div>
                )}
              </div>

              <div className="rounded-[1.8rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Receipts and execution</div>
                <div className="mt-4 space-y-3">
                  {selectedRun.receipts.length === 0 ? (
                    <div className="text-sm leading-7 text-[var(--muted)]">No receipts emitted for this run.</div>
                  ) : (
                    selectedRun.receipts.map((receipt) => (
                      <div key={receipt.receiptId} className="rounded-[1.4rem] border border-[var(--line)] bg-black/22 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-[var(--paper)]">{receipt.symbolOrToken}</div>
                            <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{receipt.venue} · {receipt.status}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-[var(--paper)]">{formatCurrency(receipt.notionalUsd)}</div>
                            <div className="text-xs text-[var(--muted)]">{receipt.side}</div>
                          </div>
                        </div>
                        <div className="mt-3 text-sm leading-7 text-[var(--paper)]">{receipt.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-[1.8rem] border border-[var(--line)] bg-black/18 p-5 text-sm leading-7 text-[var(--muted)]">
              Launch a run to inspect review scores, instrument candidates, and receipts.
            </div>
          )}
        </section>

        <section className="section-reveal rounded-[2.2rem] border border-[var(--line)] bg-[rgba(255,255,255,0.04)] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.24em] text-[var(--muted)]">Strategy book</div>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                Saved versions and promotion state
              </div>
            </div>
            <KeyRound className="h-6 w-6 text-[var(--signal)]" />
          </div>

          <div className="mt-6 grid gap-4">
            {strategies.map((strategy) => (
              <div key={strategy.id} className="rounded-[1.9rem] border border-[var(--line)] bg-black/18 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">v{strategy.version} · {strategy.source}</span>
                      <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] ${toneForReadiness(strategy.readiness)}`}>
                        {strategy.readiness}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.22em] ${toneForApproval(strategy.approvalState)}`}>
                        {strategy.approvalState}
                      </span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--paper)]">{strategy.name}</div>
                    <div className="mt-3 text-sm leading-7 text-[var(--paper)]">{strategy.thesis}</div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button className="secondary-button justify-center" onClick={() => toggleStrategyApproval(strategy.id)}>
                      {strategy.approvalState === "live-armed" ? "Return to Paper" : "Promote to Live"}
                    </button>
                    <button className="primary-button justify-center" onClick={() => runStrategy(strategy)}>
                      Run {strategy.runConfig.mode}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Run config</div>
                    <div className="mt-2 text-sm leading-7 text-[var(--paper)]">
                      {getRecipeDefinition(strategy.runConfig.recipeId).title}
                      <br />
                      {strategy.runConfig.countries?.join(", ")}
                    </div>
                  </div>
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Venue mapping</div>
                    <div className="mt-2 text-sm leading-7 text-[var(--paper)]">
                      {strategy.venueMapping.map((mapping) => `${mapping.venue}: ${mapping.instruments.join(", ")}`).join(" · ")}
                    </div>
                  </div>
                  <div className="rounded-[1.5rem] border border-[var(--line)] bg-black/22 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Last run</div>
                    <div className="mt-2 text-sm leading-7 text-[var(--paper)]">{strategy.lastRunSummary ?? "No runs yet."}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="section-reveal flex flex-col gap-4 rounded-[2rem] border border-[var(--line)] bg-black/20 px-5 py-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Globe2 className="h-4 w-4 text-[var(--signal)]" />
            Recipes keep explicit country and source scope so adding coverage is a registry task, not a UI fork.
          </div>
          <div className="flex items-center gap-3">
            <RefreshCcw className="h-4 w-4 text-[var(--signal)]" />
            Live routing always stays behind venue health, review score, and operator confirmation.
          </div>
        </footer>
      </div>
    </div>
  );
}
