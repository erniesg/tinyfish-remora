import { RECIPES } from "@/lib/demo/mock-data";
import type {
  AgentEvent,
  ExecutionMode,
  GeneratedStrategyResponse,
  Position,
  RecipePreset,
  RiskProfile,
  RunBatchResponse,
  RunDescriptor,
  SignalRecord,
  StrategyVersion,
  Venue,
  VenueConnection,
} from "@/lib/demo/types";

type TimedEvent = AgentEvent & { delayMs: number };

interface BatchRequest {
  recipeIds: string[];
  strategyId?: string;
  mode: ExecutionMode;
}

interface StreamRequest {
  runId: string;
  recipeId: string;
  strategyId: string;
  mode: ExecutionMode;
}

const phaseProgress: Record<AgentEvent["phase"], number> = {
  STARTED: 8,
  STREAMING_URL: 16,
  PROGRESS: 34,
  SIGNAL: 56,
  REVIEW: 72,
  DECISION: 84,
  RECEIPT: 94,
  COMPLETE: 100,
};

function iso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function pickRecipe(recipeId: string): RecipePreset {
  return RECIPES.find((recipe) => recipe.id === recipeId) ?? RECIPES[0];
}

export function assessConnection(connection: VenueConnection): VenueConnection {
  const requiredFields =
    connection.venue === "ibkr"
      ? connection.mode === "paper"
        ? ["accountId", "gatewayUrl"]
        : ["accountId", "gatewayUrl", "apiToken"]
      : connection.mode === "paper"
        ? ["walletAddress"]
        : ["walletAddress", "apiKey", "apiSecret", "passphrase", "privateKey"];

  const missing = requiredFields.filter((field) => !connection.fields[field]?.trim());

  if (missing.length === 0) {
    return {
      ...connection,
      status: connection.mode === "live" ? "warning" : "ready",
      statusNote:
        connection.mode === "live"
          ? "Live credentials loaded. Keep confirmation gates enabled."
          : "Ready for immediate demo runs.",
    };
  }

  return {
    ...connection,
    status: "missing",
    statusNote: `Missing ${missing.join(", ")}.`,
  };
}

export function buildRunBatch(request: BatchRequest): RunBatchResponse {
  const batchId = makeId("batch");
  const recipeIds = request.recipeIds.length > 0 ? request.recipeIds : [RECIPES[0].id];
  const runs: RunDescriptor[] = recipeIds.map((recipeId) => {
    const recipe = pickRecipe(recipeId);
    const runId = makeId(slugify(recipe.title));
    const strategyId = request.strategyId || `recipe-${recipe.id}`;
    return {
      batchId,
      runId,
      recipeId,
      strategyId,
      title: recipe.title,
      mode: request.mode,
      venue: recipe.primaryVenue,
      streamingUrl: `https://stream.agent.tinyfish.ai/demo/${runId}`,
      streamUrl: `/api/demo/stream/${runId}?recipeId=${recipeId}&strategyId=${strategyId}&mode=${request.mode}`,
    };
  });

  return {
    batchId,
    createdAt: new Date().toISOString(),
    mode: request.mode,
    runs,
  };
}

function priceForInstrument(instrument: string, venue: Venue): number {
  const seed = hashString(instrument);
  if (venue === "ibkr") {
    return 18 + (seed % 2000) / 100;
  }
  return 0.28 + (seed % 36) / 100;
}

function makeSignal(recipe: RecipePreset, runId: string): SignalRecord {
  const seed = hashString(`${recipe.id}-${runId}`);

  const signalMap: Record<
    string,
    { instrument: string; direction: SignalRecord["direction"]; source: string; language: string }
  > = {
    "ndrc-policy-lag": {
      instrument: "KWEB",
      direction: "long",
      source: "NDRC policy bulletin",
      language: "zh-CN",
    },
    "boj-yen-lag": {
      instrument: "EWJ",
      direction: "long",
      source: "Bank of Japan release archive",
      language: "ja-JP",
    },
    "polymarket-divergence": {
      instrument: "Fed Cut 2026 YES",
      direction: "yes",
      source: "Primary source event monitor",
      language: "en",
    },
  };

  const selected = signalMap[recipe.id] ?? signalMap["ndrc-policy-lag"];
  const score = 74 + (seed % 19);
  const confidence = clamp(score / 100, 0.68, 0.96);
  const title =
    recipe.id === "polymarket-divergence"
      ? "Official update landed before probability curve adjusted"
      : "Primary-language policy bulletin landed ahead of US session repricing";

  return {
    id: makeId("signal"),
    recipeId: recipe.id,
    title,
    source: selected.source,
    sourceUrl: `https://example.com/${recipe.id}/${runId}`,
    language: selected.language,
    publishedAt: iso(-180),
    venue: recipe.primaryVenue,
    instrument: selected.instrument,
    direction: selected.direction,
    confidence,
    score,
    keywords: recipe.keywords.slice(0, 4),
    reasoning:
      recipe.id === "polymarket-divergence"
        ? "Probability stayed stale despite an official confirmation path surfacing in the monitored sources."
        : "The release materially shifted policy tone and the ticker basket remains under-reacted in liquid venues.",
  };
}

function buildPosition(
  signal: SignalRecord,
  strategyId: string,
  strategyName: string,
  mode: ExecutionMode,
): Position {
  const entryPrice = priceForInstrument(signal.instrument, signal.venue);
  const quantity = signal.venue === "ibkr" ? 6 + signal.score / 10 : 280 + signal.score * 4;
  const markDelta = signal.venue === "ibkr" ? 0.74 : 0.03;

  return {
    id: makeId("position"),
    strategyId,
    strategyName,
    venue: signal.venue,
    mode,
    instrument: signal.instrument,
    direction: signal.direction,
    quantity: Number(quantity.toFixed(signal.venue === "ibkr" ? 2 : 0)),
    entryPrice: Number(entryPrice.toFixed(signal.venue === "ibkr" ? 2 : 2)),
    markPrice: Number((entryPrice + markDelta).toFixed(signal.venue === "ibkr" ? 2 : 2)),
    exposureUsd: Number((entryPrice * quantity).toFixed(2)),
    realizedPnlUsd: 0,
    status: "open",
    updatedAt: iso(),
  };
}

export function buildRunTimeline(request: StreamRequest): TimedEvent[] {
  const recipe = pickRecipe(request.recipeId);
  const signal = makeSignal(recipe, request.runId);
  const strategyName = recipe.title;
  const position = buildPosition(signal, request.strategyId, strategyName, request.mode);
  const notionalUsd =
    request.mode === "live"
      ? Math.min(position.exposureUsd, recipe.primaryVenue === "ibkr" ? 1500 : 850)
      : Math.min(position.exposureUsd, recipe.primaryVenue === "ibkr" ? 750 : 400);
  const fillPrice = priceForInstrument(signal.instrument, signal.venue);
  const quantity = Number((notionalUsd / fillPrice).toFixed(signal.venue === "ibkr" ? 2 : 0));

  const intent = {
    id: makeId("intent"),
    strategyId: request.strategyId,
    venue: recipe.primaryVenue,
    mode: request.mode,
    instrument: signal.instrument,
    side: signal.direction === "short" || signal.direction === "no" ? "sell" : "buy",
    notionalUsd: Number(notionalUsd.toFixed(2)),
    maxSlippageBps: recipe.primaryVenue === "ibkr" ? 45 : 30,
    thesis: recipe.thesis,
    label: `${recipe.title} :: ${signal.instrument}`,
  } as const;

  const receipt = {
    id: makeId("receipt"),
    runId: request.runId,
    status: request.mode === "live" ? "submitted" : "filled",
    venue: recipe.primaryVenue,
    mode: request.mode,
    instrument: signal.instrument,
    side: intent.side,
    notionalUsd: intent.notionalUsd,
    fillPrice: Number(fillPrice.toFixed(signal.venue === "ibkr" ? 2 : 2)),
    quantity,
    message:
      request.mode === "live"
        ? "Live order handed to routing layer with confirmation gate intact."
        : "Paper receipt simulated from current mark and venue constraints.",
  } as const;

  const streamMeta = {
    browser_profile: "stealth",
    proxy_country_code: recipe.sourceLocale === "ja-JP" ? "JP" : "US",
    parallel_plan: recipe.parallelPlan,
  };

  return [
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "STARTED",
      timestamp: iso(),
      message: `${recipe.title} booted with ${recipe.keywords.slice(0, 3).join(", ")}.`,
      progress: phaseProgress.STARTED,
      meta: {
        recipe: recipe.title,
        source_locale: recipe.sourceLocale,
      },
      delayMs: 300,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "STREAMING_URL",
      timestamp: iso(1),
      message: "TinyFish streaming URL captured for operator replay.",
      progress: phaseProgress.STREAMING_URL,
      meta: {
        streaming_url: `https://stream.agent.tinyfish.ai/demo/${request.runId}`,
      },
      delayMs: 350,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "PROGRESS",
      timestamp: iso(2),
      message: `Running collectors in parallel. ${recipe.parallelPlan}`,
      progress: phaseProgress.PROGRESS,
      meta: streamMeta,
      delayMs: 650,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "PROGRESS",
      timestamp: iso(3),
      message:
        "Goal hardened with numbered steps, explicit stop conditions, and fallback JSON for blocked or unchanged states.",
      progress: phaseProgress.PROGRESS + 8,
      meta: {
        anti_bot: recipe.antiBotPolicy[0],
      },
      delayMs: 700,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "SIGNAL",
      timestamp: iso(4),
      message: signal.reasoning,
      progress: phaseProgress.SIGNAL,
      signal,
      delayMs: 800,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "REVIEW",
      timestamp: iso(5),
      message: `Scored ${signal.instrument} at ${signal.score}/100 with confidence ${(signal.confidence * 100).toFixed(0)}%.`,
      progress: phaseProgress.REVIEW,
      meta: {
        scoring_model: "tinyfish-signal-stack:v1",
        venue_readiness: recipe.primaryVenue === "ibkr" ? "paper-and-live" : "paper-plus-live-with-l2-auth",
      },
      signal,
      delayMs: 900,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "DECISION",
      timestamp: iso(6),
      message: `${request.mode === "live" ? "Live" : "Paper"} execution intent approved with venue-aware slippage and risk caps.`,
      progress: phaseProgress.DECISION,
      intent,
      delayMs: 650,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "RECEIPT",
      timestamp: iso(7),
      message: receipt.message,
      progress: phaseProgress.RECEIPT,
      receipt,
      position,
      delayMs: 750,
    },
    {
      id: makeId("evt"),
      runId: request.runId,
      recipeId: recipe.id,
      phase: "COMPLETE",
      timestamp: iso(8),
      message: `${recipe.title} complete. ${request.mode === "live" ? "Routing armed." : "Paper P&L now updating."}`,
      progress: phaseProgress.COMPLETE,
      meta: {
        summary: `${receipt.venue.toUpperCase()} ${receipt.status} :: ${receipt.instrument}`,
      },
      receipt,
      position,
      delayMs: 250,
    },
  ];
}

function riskTemplate(riskProfile: RiskProfile) {
  if (riskProfile === "aggressive") {
    return {
      perTradeMaxUsd: 1250,
      dailyLossLimitUsd: 2800,
      maxOpenPositions: 5,
      slippageBpsLimit: 70,
    };
  }
  if (riskProfile === "conservative") {
    return {
      perTradeMaxUsd: 400,
      dailyLossLimitUsd: 900,
      maxOpenPositions: 2,
      slippageBpsLimit: 25,
    };
  }
  return {
    perTradeMaxUsd: 800,
    dailyLossLimitUsd: 1600,
    maxOpenPositions: 3,
    slippageBpsLimit: 45,
  };
}

function classifyObjective(objective: string): {
  thesis: string;
  venues: Venue[];
  universe: string[];
  recipeIds: string[];
} {
  const normalized = objective.toLowerCase();

  if (normalized.includes("japan") || normalized.includes("yen") || normalized.includes("boj")) {
    return {
      thesis:
        "Japanese-language official releases can leak a cleaner directional read into exporter-sensitive equities before the broader market harmonizes the translation.",
      venues: ["ibkr"],
      universe: ["EWJ", "FXY", "Toyota ADR"],
      recipeIds: ["boj-yen-lag"],
    };
  }

  if (
    normalized.includes("prediction") ||
    normalized.includes("polymarket") ||
    normalized.includes("odds") ||
    normalized.includes("probability")
  ) {
    return {
      thesis:
        "Primary-source confirmation and market metadata together let the agent distinguish stale odds from fast-moving crowd information.",
      venues: ["polymarket"],
      universe: ["Fed Cut 2026 YES", "reform package approval YES"],
      recipeIds: ["polymarket-divergence"],
    };
  }

  return {
    thesis:
      "Non-English official policy releases often create a measurable time lag before IBKR-tradable names and related prediction markets reprice.",
    venues: ["ibkr", "polymarket"],
    universe: ["KWEB", "FXI", "BABA", "China growth surprise markets"],
    recipeIds: ["ndrc-policy-lag", "polymarket-divergence"],
  };
}

export function generateStrategyFromBrief(
  objective: string,
  riskProfile: RiskProfile,
  preferredVenue: "ibkr" | "polymarket" | "both",
): GeneratedStrategyResponse {
  const objectiveKeywords = uniqueStrings(
    objective
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3)
      .slice(0, 8),
  );
  const playbook = classifyObjective(objective);
  const venues = preferredVenue === "both" ? playbook.venues : [preferredVenue];
  const recipeIds = playbook.recipeIds.filter((recipeId) => {
    const recipe = pickRecipe(recipeId);
    return preferredVenue === "both" ? true : recipe.venues.includes(preferredVenue);
  });

  const recipeKeywords = recipeIds.flatMap((recipeId) => pickRecipe(recipeId).keywords.slice(0, 3));
  const keywords = uniqueStrings([...objectiveKeywords, ...recipeKeywords]).slice(0, 10);
  const risk = riskTemplate(riskProfile);
  const nameRoot = objectiveKeywords.slice(0, 2).join(" ");

  const strategy: StrategyVersion = {
    id: makeId(`strategy-${slugify(nameRoot || "alpha-hunt")}`),
    version: 1,
    name: `Autonomous ${nameRoot ? nameRoot.replace(/\b\w/g, (char) => char.toUpperCase()) : "Alpha Hunt"}`,
    source: "agent-generated",
    objective,
    thesis: playbook.thesis,
    recipeIds: recipeIds.length > 0 ? recipeIds : ["ndrc-policy-lag"],
    keywords,
    universe: playbook.universe,
    venues,
    riskProfile,
    scoringModel: "tinyfish-signal-stack:v1",
    entryRules: [
      "Require a fresh primary-source signal, structured review score above 80, and a venue-specific execution path that passed preflight.",
      "Capture the TinyFish stream URL and preserve artifacts for every live-facing run.",
    ],
    exitRules: [
      "Exit after thesis decay, official confirmation broadening, or max holding window breach.",
      "Cancel or skip when the soft-failure fallback returns blocked, null, or unchanged states.",
    ],
    risk,
    execution: {
      mode: "paper",
      autoEntry: true,
      autoExit: true,
    },
    rationale: [
      "The agent chose recipes that already encode anti-bot, fallback, and structured extraction guidance.",
      "Execution defaults to paper so the strategy can be reviewed, saved, and promoted later.",
      "Venue selection stays explicit to preserve preflight and credential health checks.",
    ],
    createdAt: new Date().toISOString(),
  };

  return {
    strategy,
    scorecard: [
      {
        label: "Latency Edge",
        score: preferredVenue === "polymarket" ? 83 : 88,
        note: "Primary-language and primary-source monitoring is aligned with the demo’s strongest edge.",
      },
      {
        label: "Execution Readiness",
        score: preferredVenue === "polymarket" ? 76 : 84,
        note: "Paper routes are ready now; live routes require credentials and confirmation gates.",
      },
      {
        label: "Anti-Bot Resilience",
        score: 81,
        note: "Recipe prompts explicitly encode stealth, proxy, consent handling, and fallback JSON.",
      },
    ],
    reasoning: [
      "The selected recipes already fit the platform’s collect-review-decide-execute runtime loop.",
      "Keyword expansion blended your objective with existing TinyFish recipe vocabulary instead of hallucinating a brand-new schema.",
      "The saved strategy keeps paper mode as the default promotion gate so the demo remains safe for retail flows.",
    ],
  };
}
