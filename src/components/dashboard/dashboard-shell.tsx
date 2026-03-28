"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChartNoAxesColumn,
  CircleDot,
  Clock3,
  History,
  Play,
  RadioTower,
  RefreshCcw,
  ScanSearch,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { ensureDemoAccounts, readDemoSession, resumeDemoAccount } from "@/lib/demo/auth";
import { RECIPE_REGISTRY } from "@/lib/demo/mock-data";
import type {
  AgentEvent,
  DemoUser,
  ExecutionMode,
  RawSignal,
  ReviewedSignal,
  RunLaunchResponse,
  RunRequest,
  RunSummary,
  VenueCandidate,
} from "@/lib/demo/types";
import type { RuntimeStatusResponse } from "@/lib/runtime/types";

const RUNS_KEY = "tinyfish-remora-runs";
const MAX_HISTORY = 12;

type StoredRun = RunSummary & {
  events: AgentEvent[];
  runtimeWarnings: string[];
};

const COUNTRY_LABELS: Record<string, string> = {
  CN: "China",
  DE: "Germany",
  EU: "Europe",
  FR: "France",
  GLOBAL: "Global",
  IT: "Italy",
  JP: "Japan",
  US: "United States",
};

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback;

  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function formatCountry(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "Not yet";

  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));

  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "Pending";

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatProviderLabel(provider: string): string {
  if (provider === "ibkr") return "IBKR";
  if (provider === "polymarket") return "Polymarket";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatPhase(phase: AgentEvent["phase"]): string {
  return phase.toLowerCase().replaceAll("_", " ");
}

function makeSelection(
  values: string[],
  item: string,
  fallback: string[],
  allowEmpty = false,
): string[] {
  const exists = values.includes(item);
  const nextValues = exists
    ? values.filter((value) => value !== item)
    : [...values, item];

  if (allowEmpty || nextValues.length > 0) return nextValues;
  return fallback;
}

function mergeByKey<T>(items: T[], nextItem: T, getKey: (item: T) => string): T[] {
  const key = getKey(nextItem);
  const index = items.findIndex((item) => getKey(item) === key);

  if (index === -1) return [...items, nextItem];

  return items.map((item, currentIndex) => (currentIndex === index ? nextItem : item));
}

function upsertRun(runs: StoredRun[], nextRun: StoredRun): StoredRun[] {
  return [nextRun, ...runs.filter((run) => run.id !== nextRun.id)].slice(0, MAX_HISTORY);
}

function createPendingRun(launch: RunLaunchResponse): StoredRun {
  const startedAt = new Date().toISOString();

  return {
    id: launch.runId,
    label: launch.label,
    request: launch.request,
    recipeId: launch.request.recipeId,
    strategyId: launch.request.strategyId,
    mode: launch.request.mode,
    status: "running",
    progress: 4,
    phase: "STARTED",
    startedAt,
    lastMessage: "Run queued.",
    streamingUrl: launch.streamingUrl,
    rawSignals: [],
    reviewedSignals: [],
    intents: [],
    receipts: [],
    fallbackState: undefined,
    runtimeMode: launch.runtimeMode,
    events: [],
    runtimeWarnings: launch.runtimeWarnings ?? [],
  };
}

function applyEvent(run: StoredRun, event: AgentEvent): StoredRun {
  const rawSignals = event.rawSignal
    ? mergeByKey(run.rawSignals, event.rawSignal, (signal) => signal.id)
    : run.rawSignals;

  const reviewedSignals = event.reviewedSignal
    ? mergeByKey(
        run.reviewedSignals,
        event.reviewedSignal,
        (signal) => `${signal.fingerprint}:${signal.source}`,
      )
    : run.reviewedSignals;

  const intents = event.intent
    ? mergeByKey(
        run.intents,
        event.intent,
        (intent) => `${intent.reviewFingerprint}:${intent.venue}:${intent.symbolOrToken}`,
      )
    : run.intents;

  const receipts = event.receipt
    ? mergeByKey(run.receipts, event.receipt, (receipt) => receipt.receiptId)
    : run.receipts;

  const events = mergeByKey(run.events, event, (entry) => entry.id);
  const isFinal = event.phase === "COMPLETE" || event.phase === "BLOCKED";

  return {
    ...run,
    recipeId: event.recipeId ?? run.recipeId,
    strategyId: event.strategyId ?? run.strategyId,
    status: event.phase === "BLOCKED" ? "blocked" : isFinal ? "complete" : "running",
    progress: isFinal ? 100 : event.progress,
    phase: event.phase,
    completedAt: isFinal ? event.timestamp : run.completedAt,
    lastMessage: event.message,
    rawSignals,
    reviewedSignals,
    intents,
    receipts,
    events,
    fallbackState:
      event.phase === "BLOCKED"
        ? "blocked"
        : isFinal && rawSignals.length === 0
          ? "empty"
          : run.fallbackState,
  };
}

function RuntimePill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "accent" | "success" | "warning";
}) {
  const toneClass =
    tone === "accent"
      ? "border-[rgba(255,105,71,0.35)] bg-[rgba(255,105,71,0.08)] text-[var(--paper)]"
      : tone === "success"
        ? "border-[rgba(125,211,168,0.3)] bg-[rgba(125,211,168,0.08)] text-[var(--paper)]"
        : tone === "warning"
          ? "border-[rgba(255,214,120,0.26)] bg-[rgba(255,214,120,0.08)] text-[var(--paper)]"
          : "border-[var(--line)] bg-white/[0.03] text-[var(--muted)]";

  return (
    <div className={`rounded-full border px-3 py-1.5 text-xs ${toneClass}`}>
      <span className="uppercase tracking-[0.24em] text-[0.68rem] text-[var(--muted)]">
        {label}
      </span>
      <span className="ml-2 font-medium text-[var(--paper)]">{value}</span>
    </div>
  );
}

export function DashboardShell() {
  const [profile, setProfile] = useState<DemoUser | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatusResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchPending, setLaunchPending] = useState(false);
  const [loadedRuns, setLoadedRuns] = useState(false);
  const [recipeId, setRecipeId] = useState(RECIPE_REGISTRY[0]?.id ?? "");
  const [mode, setMode] = useState<ExecutionMode>("paper");
  const [selectedCountries, setSelectedCountries] = useState<string[]>(
    RECIPE_REGISTRY[0]?.countries ?? [],
  );
  const [selectedSources, setSelectedSources] = useState<string[]>(
    RECIPE_REGISTRY[0]?.sources.map((source) => source.id) ?? [],
  );
  const [preferredVenue, setPreferredVenue] = useState<VenueCandidate>(
    RECIPE_REGISTRY[0]?.defaultVenueBias ?? "both",
  );

  const streamRef = useRef<EventSource | null>(null);
  const ledgerRef = useRef<HTMLDivElement | null>(null);

  const recipe = RECIPE_REGISTRY.find((entry) => entry.id === recipeId) ?? RECIPE_REGISTRY[0];
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const activeRun = runs.find((run) => run.status === "running") ?? null;
  const liveModeWarning =
    mode === "live" && runtime?.mode !== "live"
      ? "Live mode is armed in the UI, but missing providers can still force demo fallback."
      : mode === "paper"
        ? "Paper mode records decisions and receipts without pushing live broker orders."
        : "All provider lanes are enabled for live routing.";

  useEffect(() => {
    const accounts = ensureDemoAccounts();
    const session = readDemoSession() ?? resumeDemoAccount(accounts[0].id);
    const storedRuns = readJson<StoredRun[]>(RUNS_KEY, []);

    setProfile(session);
    setRuns(storedRuns);
    setSelectedRunId(storedRuns[0]?.id ?? null);
    setLoadedRuns(true);

    return () => {
      streamRef.current?.close();
    };
  }, []);

  useEffect(() => {
    setSelectedCountries(recipe.countries);
    setSelectedSources(recipe.sources.map((source) => source.id));
    setPreferredVenue(recipe.defaultVenueBias);
  }, [recipe.id, recipe.countries, recipe.defaultVenueBias, recipe.sources]);

  useEffect(() => {
    if (!loadedRuns) return;
    writeJson(RUNS_KEY, runs);
  }, [loadedRuns, runs]);

  useEffect(() => {
    if (!runs.length) {
      setSelectedRunId(null);
      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRun) return;
    ledgerRef.current?.scrollTo({
      top: ledgerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedRun]);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeStatus() {
      try {
        const response = await fetch("/api/runtime/status", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Runtime status request failed.");
        }

        const nextRuntime = (await response.json()) as RuntimeStatusResponse;

        if (!cancelled) {
          setRuntime(nextRuntime);
          setRuntimeError(null);
        }
      } catch {
        if (!cancelled) {
          setRuntime(null);
          setRuntimeError("Runtime status unavailable.");
        }
      }
    }

    void loadRuntimeStatus();
    const interval = window.setInterval(() => {
      void loadRuntimeStatus();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function launchRun(requestOverride?: Partial<RunRequest>) {
    streamRef.current?.close();
    setLaunchPending(true);
    setLaunchError(null);

    const requestBody: Partial<RunRequest> = {
      recipeId: recipe.id,
      countries: selectedCountries,
      sources: selectedSources,
      mode,
      execute: true,
      previewOnly: false,
      force: true,
      preferredVenue,
      ...requestOverride,
    };

    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error("Run launch failed.");
      }

      const launch = (await response.json()) as RunLaunchResponse;
      const pendingRun = createPendingRun(launch);

      setRuns((currentRuns) => upsertRun(currentRuns, pendingRun));
      setSelectedRunId(launch.runId);
      setRuntime((currentRuntime) =>
        currentRuntime
          ? {
              ...currentRuntime,
              mode: launch.runtimeMode ?? currentRuntime.mode,
              warnings: launch.runtimeWarnings ?? currentRuntime.warnings,
            }
          : currentRuntime,
      );

      const source = new EventSource(launch.streamUrl);
      streamRef.current = source;

      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as AgentEvent;

          setRuns((currentRuns) =>
            upsertRun(
              currentRuns,
              applyEvent(
                currentRuns.find((run) => run.id === launch.runId) ?? pendingRun,
                event,
              ),
            ),
          );

          if (event.phase === "COMPLETE" || event.phase === "BLOCKED") {
            source.close();
            if (streamRef.current === source) {
              streamRef.current = null;
            }
          }
        } catch {
          setLaunchError("The run stream returned an unreadable event.");
          source.close();
          if (streamRef.current === source) {
            streamRef.current = null;
          }
        }
      };

      source.onerror = () => {
        source.close();
        if (streamRef.current === source) {
          streamRef.current = null;
        }

        setRuns((currentRuns) => {
          const currentRun = currentRuns.find((run) => run.id === launch.runId);
          if (!currentRun || currentRun.status !== "running") return currentRuns;

          return upsertRun(currentRuns, {
            ...currentRun,
            status: "blocked",
            phase: "BLOCKED",
            progress: 100,
            completedAt: new Date().toISOString(),
            lastMessage: "Stream closed before the run completed.",
          });
        });
      };
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : "Run launch failed.");
    } finally {
      setLaunchPending(false);
    }
  }

  function replayRun(run: StoredRun) {
    void launchRun(run.request);
  }

  return (
    <div className="min-h-[100dvh] bg-transparent px-4 py-4 sm:px-6 sm:py-6">
      <div
        className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[rgba(11,14,16,0.82)] shadow-[0_24px_120px_rgba(0,0,0,0.34)] animate-[stage-in_420ms_cubic-bezier(0.22,1,0.36,1)_both]"
        data-testid="dashboard-workbench"
      >
        <header className="border-b border-[var(--line)] px-5 py-5 sm:px-8 sm:py-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="text-[0.7rem] uppercase tracking-[0.34em] text-[var(--muted)]">
                tinyfish-remora
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.07em] text-[var(--paper)] sm:text-5xl">
                Run the scan. Review the signal. Replay the trade.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)] sm:text-base">
                Start in the workbench. Pick a recipe, narrow the country and source set, launch
                paper or live mode, and keep every run available for review and replay.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <RuntimePill
                label="Runtime"
                value={runtime?.mode ?? "Checking"}
                tone={runtime?.mode === "live" ? "success" : runtime?.mode === "hybrid" ? "accent" : "neutral"}
              />
              <RuntimePill
                label="Profile"
                value={profile?.name ?? "Loading"}
                tone="neutral"
              />
              <Link
                href="/auth"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/[0.03] px-4 py-2.5 text-sm text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)] hover:bg-white/[0.05]"
              >
                <UserRound className="h-4 w-4 text-[var(--signal)]" />
                Profiles
              </Link>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2.5">
            {(runtime?.providers ?? []).map((provider) => (
              <RuntimePill
                key={provider.provider}
                label={formatProviderLabel(provider.provider)}
                value={provider.enabled ? "Live" : "Fallback"}
                tone={provider.enabled ? "success" : "warning"}
              />
            ))}
            {runtimeError ? (
              <RuntimePill label="Status" value={runtimeError} tone="warning" />
            ) : null}
          </div>
        </header>

        <div className="grid xl:grid-cols-[minmax(0,1.45fr)_24rem]">
          <main className="border-b border-[var(--line)] xl:border-r xl:border-b-0">
            <section id="launch-section" className="border-b border-[var(--line)] px-5 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[0.7rem] uppercase tracking-[0.28em] text-[var(--muted)]">
                      01 Setup
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                      Configure the next run
                    </h2>
                  </div>
                  <div className="max-w-xl text-sm leading-7 text-[var(--muted)]">
                    Utility first. No strategy book, no account hurdle, no dead-end landing page.
                  </div>
                </div>

                <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)]">
                    <div className="border-b border-[var(--line)] px-4 py-3 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      Recipe
                    </div>
                    <div className="divide-y divide-[var(--line)]">
                      {RECIPE_REGISTRY.map((entry) => {
                        const active = entry.id === recipe.id;

                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => setRecipeId(entry.id)}
                            className={`flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors ${
                              active
                                ? "bg-white/[0.05]"
                                : "bg-transparent hover:bg-white/[0.03]"
                            }`}
                          >
                            <div>
                              <div className="text-sm font-medium text-[var(--paper)]">
                                {entry.title}
                              </div>
                              <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                                {entry.subtitle}
                              </div>
                            </div>
                            <div className="shrink-0 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                              {entry.readiness}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <div className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--muted)]">
                          Mode
                        </div>
                        <div className="mt-3 inline-flex rounded-full border border-[var(--line)] bg-white/[0.02] p-1">
                          {(["paper", "live"] as const).map((entryMode) => (
                            <button
                              key={entryMode}
                              type="button"
                              onClick={() => setMode(entryMode)}
                              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                                mode === entryMode
                                  ? "bg-[var(--signal)] text-black"
                                  : "text-[var(--muted)] hover:text-[var(--paper)]"
                              }`}
                            >
                              {entryMode === "paper" ? "Paper" : "Live"}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--muted)]">
                          Route
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[
                            ...new Set<VenueCandidate>([
                              recipe.defaultVenueBias,
                              ...recipe.supportedVenues,
                              recipe.supportedVenues.length > 1 ? "both" : recipe.supportedVenues[0],
                            ]),
                          ].map((venue) => (
                            <button
                              key={venue}
                              type="button"
                              onClick={() => setPreferredVenue(venue)}
                              className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                                preferredVenue === venue
                                  ? "border-[rgba(255,105,71,0.35)] bg-[rgba(255,105,71,0.08)] text-[var(--paper)]"
                                  : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--paper)]"
                              }`}
                            >
                              {venue === "both"
                                ? "Both"
                                : venue === "ibkr"
                                  ? "IBKR"
                                  : venue === "polymarket"
                                    ? "Polymarket"
                                    : "None"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--muted)]">
                        Countries
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {recipe.countries.map((country) => (
                          <button
                            key={country}
                            type="button"
                            onClick={() =>
                              setSelectedCountries((currentCountries) =>
                                makeSelection(currentCountries, country, recipe.countries),
                              )
                            }
                            className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                              selectedCountries.includes(country)
                                ? "border-[rgba(255,105,71,0.35)] bg-[rgba(255,105,71,0.08)] text-[var(--paper)]"
                                : "border-[var(--line)] text-[var(--muted)] hover:text-[var(--paper)]"
                            }`}
                          >
                            {formatCountry(country)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[0.72rem] uppercase tracking-[0.24em] text-[var(--muted)]">
                        Sources
                      </div>
                      <div className="mt-3 grid gap-2">
                        {recipe.sources.map((source) => (
                          <label
                            key={source.id}
                            className="flex items-start justify-between gap-4 rounded-[1.15rem] border border-[var(--line)] px-4 py-3 transition-colors hover:border-[rgba(255,105,71,0.22)]"
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selectedSources.includes(source.id)}
                                onChange={() =>
                                  setSelectedSources((currentSources) =>
                                    makeSelection(
                                      currentSources,
                                      source.id,
                                      recipe.sources.map((entry) => entry.id),
                                    ),
                                  )
                                }
                                className="mt-1 h-4 w-4 accent-[var(--signal)]"
                              />
                              <div>
                                <div className="text-sm font-medium text-[var(--paper)]">
                                  {source.name}
                                </div>
                                <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                                  {formatCountry(source.country)} · {source.kind} · {source.cadence}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                              {source.status}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-4 border-t border-[var(--line)] pt-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void launchRun()}
                          disabled={launchPending || activeRun !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--signal)] px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-[#ff785b] disabled:cursor-not-allowed disabled:bg-[rgba(255,105,71,0.5)]"
                          data-testid="launch-run"
                        >
                          {activeRun ? "Run in progress" : mode === "paper" ? "Launch paper run" : "Launch live run"}
                          <ArrowRight className="h-4 w-4" />
                        </button>

                        {selectedRun ? (
                          <button
                            type="button"
                            onClick={() => replayRun(selectedRun)}
                            disabled={launchPending || activeRun !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--line)] px-5 py-3 text-sm text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid="replay-selected-run"
                          >
                            <RefreshCcw className="h-4 w-4" />
                            Replay selected run
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-2 text-sm leading-7 text-[var(--muted)]">
                        <div>{liveModeWarning}</div>
                        {launchError ? (
                          <div className="text-[var(--danger)]">{launchError}</div>
                        ) : null}
                        {selectedRun?.runtimeWarnings.length ? (
                          <div className="text-[var(--muted)]">
                            {selectedRun.runtimeWarnings.join(" ")}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="border-b border-[var(--line)] px-5 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[0.7rem] uppercase tracking-[0.28em] text-[var(--muted)]">
                      02 Stream
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                      Run stream
                    </h2>
                  </div>

                  {selectedRun ? (
                    <div className="text-sm leading-7 text-[var(--muted)]">
                      {selectedRun.label} · {selectedRun.mode} · {formatTimestamp(selectedRun.startedAt)}
                    </div>
                  ) : null}
                </div>

                {selectedRun ? (
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(14rem,0.75fr)]">
                    <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)]">
                      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                          Event ledger
                        </div>
                        <div className="text-sm text-[var(--paper)]">
                          {selectedRun.status === "running" ? "Live" : selectedRun.status}
                        </div>
                      </div>

                      <div className="border-b border-[var(--line)] px-4 py-4">
                        <div className="progress-beam h-2 rounded-full bg-white/[0.05]">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,#ff7152_0%,#ffd27c_100%)] transition-[width] duration-500"
                            style={{ width: `${Math.max(selectedRun.progress, 8)}%` }}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <RuntimePill label="Phase" value={formatPhase(selectedRun.phase)} tone="neutral" />
                          <RuntimePill label="Signals" value={`${selectedRun.rawSignals.length}`} tone="neutral" />
                          <RuntimePill label="Reviewed" value={`${selectedRun.reviewedSignals.length}`} tone="neutral" />
                          <RuntimePill label="Receipts" value={`${selectedRun.receipts.length}`} tone="neutral" />
                        </div>
                      </div>

                      <div
                        ref={ledgerRef}
                        className="max-h-[28rem] space-y-0 overflow-auto"
                        data-testid="event-ledger"
                      >
                        {selectedRun.events.length ? (
                          selectedRun.events.map((event) => (
                            <div
                              key={event.id}
                              className="border-b border-[var(--line)] px-4 py-4 last:border-b-0"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-[var(--paper)]">
                                  {event.message}
                                </div>
                                <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                                  {formatPhase(event.phase)}
                                </div>
                              </div>
                              <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                                {formatTimestamp(event.timestamp)}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="px-4 py-8 text-sm leading-7 text-[var(--muted)]">
                            Launch a run to populate the stream ledger.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)]">
                      <div className="border-b border-[var(--line)] px-4 py-3 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                        Run summary
                      </div>
                      <div className="space-y-4 px-4 py-4 text-sm leading-7 text-[var(--muted)]">
                        <div>
                          <div className="text-[var(--paper)]">Streaming URL</div>
                          <div className="mt-1 break-all">{selectedRun.streamingUrl}</div>
                        </div>
                        <div>
                          <div className="text-[var(--paper)]">Last update</div>
                          <div className="mt-1">{selectedRun.lastMessage}</div>
                        </div>
                        <div>
                          <div className="text-[var(--paper)]">Started</div>
                          <div className="mt-1">{formatTimestamp(selectedRun.startedAt)}</div>
                        </div>
                        <div>
                          <div className="text-[var(--paper)]">Completed</div>
                          <div className="mt-1">{formatTimestamp(selectedRun.completedAt)}</div>
                        </div>
                        <div>
                          <div className="text-[var(--paper)]">Countries</div>
                          <div className="mt-1">
                            {(selectedRun.request.countries ?? []).map(formatCountry).join(", ") || "Recipe default"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] px-5 py-10 text-sm leading-7 text-[var(--muted)]">
                    No runs yet. Launch the default paper pass or switch to live mode and use the
                    current runtime fallback path.
                  </div>
                )}
              </div>
            </section>

            <section className="px-5 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-6">
                <div>
                  <div className="text-[0.7rem] uppercase tracking-[0.28em] text-[var(--muted)]">
                    03 Review
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                    Signals, decisions, receipts
                  </h2>
                </div>

                <div className="grid gap-6 xl:grid-cols-3">
                  <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)]">
                    <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      <ScanSearch className="h-4 w-4 text-[var(--signal)]" />
                      Raw signals
                    </div>
                    <div className="max-h-[24rem] overflow-auto" data-testid="raw-signals">
                      {selectedRun?.rawSignals.length ? (
                        selectedRun.rawSignals.map((signal) => (
                          <RawSignalRow key={signal.id} signal={signal} />
                        ))
                      ) : (
                        <EmptyState text="Raw source hits land here after the collector step." />
                      )}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)]">
                    <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      <ShieldCheck className="h-4 w-4 text-[var(--signal)]" />
                      Reviewed signals
                    </div>
                    <div className="max-h-[24rem] overflow-auto" data-testid="reviewed-signals">
                      {selectedRun?.reviewedSignals.length ? (
                        selectedRun.reviewedSignals.map((signal) => (
                          <ReviewedSignalRow key={`${signal.fingerprint}:${signal.source}`} signal={signal} />
                        ))
                      ) : (
                        <EmptyState text="Reviewed signals and tradeable instrument candidates show up here." />
                      )}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)]">
                    <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                      <ChartNoAxesColumn className="h-4 w-4 text-[var(--signal)]" />
                      Receipts
                    </div>
                    <div className="max-h-[24rem] overflow-auto" data-testid="receipts">
                      {selectedRun?.receipts.length ? (
                        selectedRun.receipts.map((receipt) => (
                          <div
                            key={receipt.receiptId}
                            className="border-b border-[var(--line)] px-4 py-4 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-[var(--paper)]">
                                {receipt.symbolOrToken}
                              </div>
                              <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                                {receipt.status}
                              </div>
                            </div>
                            <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                              {receipt.venue.toUpperCase()} · {receipt.mode} · {receipt.side} · $
                              {receipt.notionalUsd.toFixed(0)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyState text="Execution receipts and preview artifacts appear here." />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>

          <aside className="bg-[rgba(255,255,255,0.02)]">
            <section className="border-b border-[var(--line)] px-5 py-6 sm:px-6 sm:py-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[0.7rem] uppercase tracking-[0.28em] text-[var(--muted)]">
                    History
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.05em] text-[var(--paper)]">
                    Recent runs
                  </h2>
                </div>
                <History className="h-5 w-5 text-[var(--signal)]" />
              </div>

              <div className="mt-5 space-y-3" data-testid="run-history">
                {runs.length ? (
                  runs.map((run) => {
                    const selected = run.id === selectedRun?.id;

                    return (
                      <div
                        key={run.id}
                        className={`rounded-[1.35rem] border px-4 py-4 transition-colors ${
                          selected
                            ? "border-[rgba(255,105,71,0.35)] bg-[rgba(255,105,71,0.08)]"
                            : "border-[var(--line)] bg-transparent"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedRunId(run.id)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-[var(--paper)]">{run.label}</div>
                            <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                              {run.mode}
                            </div>
                          </div>
                          <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                            {run.lastMessage}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <RuntimePill label="Status" value={run.status} tone="neutral" />
                            <RuntimePill label="When" value={formatRelative(run.startedAt)} tone="neutral" />
                          </div>
                        </button>

                        <div className="mt-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedRunId(run.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)]"
                          >
                            <Play className="h-3.5 w-3.5" />
                            Review
                          </button>
                          <button
                            type="button"
                            onClick={() => replayRun(run)}
                            disabled={launchPending || activeRun !== null}
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs text-[var(--paper)] transition-colors hover:border-[rgba(255,105,71,0.32)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            Replay
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[1.35rem] border border-dashed border-[var(--line)] px-4 py-8 text-sm leading-7 text-[var(--muted)]">
                    Completed runs stay here so you can review the stream and replay the same config.
                  </div>
                )}
              </div>
            </section>

            <section className="px-5 py-6 sm:px-6 sm:py-8">
              <div className="text-[0.7rem] uppercase tracking-[0.28em] text-[var(--muted)]">
                Live notes
              </div>
              <div className="mt-4 space-y-4 text-sm leading-7 text-[var(--muted)]">
                <div className="rounded-[1.35rem] border border-[var(--line)] px-4 py-4">
                  <div className="flex items-center gap-2 text-[var(--paper)]">
                    <RadioTower className="h-4 w-4 text-[var(--signal)]" />
                    Runtime
                  </div>
                  <div className="mt-2">
                    {runtime?.warnings.length
                      ? runtime.warnings.join(" ")
                      : "Provider health is clear enough for local testing."}
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-[var(--line)] px-4 py-4">
                  <div className="flex items-center gap-2 text-[var(--paper)]">
                    <Clock3 className="h-4 w-4 text-[var(--signal)]" />
                    Replay model
                  </div>
                  <div className="mt-2">
                    Every completed run is kept locally on this device. Replay launches the same
                    request again through the current runtime mode.
                  </div>
                </div>

                <div className="rounded-[1.35rem] border border-[var(--line)] px-4 py-4">
                  <div className="flex items-center gap-2 text-[var(--paper)]">
                    <CircleDot className="h-4 w-4 text-[var(--signal)]" />
                    Current profile
                  </div>
                  <div className="mt-2">
                    {profile
                      ? `${profile.name} · ${profile.email} · ${profile.riskProfile}`
                      : "Loading local profile."}
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-4 py-8 text-sm leading-7 text-[var(--muted)]">{text}</div>;
}

function RawSignalRow({ signal }: { signal: RawSignal }) {
  return (
    <div className="border-b border-[var(--line)] px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--paper)]">{signal.title}</div>
        <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          {formatCountry(signal.country)}
        </div>
      </div>
      <div className="mt-1 text-sm leading-6 text-[var(--muted)]">{signal.summary}</div>
      <div className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        {signal.source} · {formatTimestamp(signal.publishedAt)}
      </div>
    </div>
  );
}

function ReviewedSignalRow({ signal }: { signal: ReviewedSignal }) {
  return (
    <div className="border-b border-[var(--line)] px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--paper)]">{signal.title}</div>
        <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          score {signal.reviewScore}
        </div>
      </div>
      <div className="mt-1 text-sm leading-6 text-[var(--muted)]">{signal.thesis}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {signal.instrumentCandidates.map((instrument) => (
          <span
            key={`${instrument.venue}:${instrument.symbolOrToken}`}
            className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--paper)]"
          >
            {instrument.venue.toUpperCase()} · {instrument.symbolOrToken}
          </span>
        ))}
      </div>
    </div>
  );
}
