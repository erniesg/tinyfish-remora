import type {
  Position,
  RecipeDefinition,
  StrategyVersion,
  VenueConnection,
} from "@/lib/demo/types";
import { GOVERNMENT_RECIPE_REGISTRY, getRecipeSources } from "@/lib/demo/registry";

function nowIso(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

const governmentRecipeById = new Map(
  GOVERNMENT_RECIPE_REGISTRY.map((recipe) => [recipe.id, recipe]),
);

export const RECIPE_REGISTRY: RecipeDefinition[] = [
  {
    ...governmentRecipeById.get("cn-policy-lag")!,
    id: "cn-policy-lag",
    title: "Mandarin Policy Lag",
    subtitle: "Official China policy bulletins before ADR repricing",
    description:
      "Scan mainland official releases, preserve the TinyFish stream, and map high-conviction policy language into liquid IBKR names and related prediction markets.",
    category: "government",
    countries: governmentRecipeById.get("cn-policy-lag")!.countries,
    sources: getRecipeSources(governmentRecipeById.get("cn-policy-lag")!.sources),
    supportedVenues: governmentRecipeById.get("cn-policy-lag")!.supportedVenues,
    readiness: governmentRecipeById.get("cn-policy-lag")!.readiness,
    evidenceCount: governmentRecipeById.get("cn-policy-lag")!.evidenceCount,
    sampleSignalCount: 42,
    lastSuccessfulRunAt: governmentRecipeById.get("cn-policy-lag")!.lastSuccessfulRunAt,
    promptVersion: governmentRecipeById.get("cn-policy-lag")!.promptVersion,
    scoringModel: "tinyfish-signal-stack:v2",
    strategyOutline:
      "Run official-source fanout, expand bilingual keywords, score tradability, and route the signal to China-sensitive equities and event markets.",
    antiBotPolicy: [
      "Use stealth browsing plus region-matched routing when ministry sites challenge automation.",
      "Handle cookies, redirects, and archive navigation before content extraction.",
    ],
    fallbackPolicy: [
      "Return explicit blocked JSON when the site resists automation.",
      "Fail over to archive or ministry listing pages before ending the run.",
    ],
    guardrails: [
      "Keep live size capped until a reviewed signal clears 85/100.",
      "Always preserve streaming URL and raw artifacts for replay.",
    ],
    knownFailureModes: governmentRecipeById.get("cn-policy-lag")!.knownFailureModes,
    suggestedSkills: ["scan", "hunt"],
    defaultVenueBias: "both",
  },
  {
    ...governmentRecipeById.get("jp-translation-drift")!,
    id: "jp-translation-drift",
    title: "BOJ Translation Drift",
    subtitle: "Japanese official language into exporter and FX-sensitive risk",
    description:
      "Watch Bank of Japan language before English summaries flatten the nuance, then route the reviewed view into FX-sensitive equities on IBKR.",
    category: "government",
    countries: governmentRecipeById.get("jp-translation-drift")!.countries,
    sources: getRecipeSources(governmentRecipeById.get("jp-translation-drift")!.sources),
    supportedVenues: governmentRecipeById.get("jp-translation-drift")!.supportedVenues,
    readiness: governmentRecipeById.get("jp-translation-drift")!.readiness,
    evidenceCount: governmentRecipeById.get("jp-translation-drift")!.evidenceCount,
    sampleSignalCount: 23,
    lastSuccessfulRunAt: governmentRecipeById.get("jp-translation-drift")!.lastSuccessfulRunAt,
    promptVersion: governmentRecipeById.get("jp-translation-drift")!.promptVersion,
    scoringModel: "tinyfish-signal-stack:v2",
    strategyOutline:
      "Compare Japanese phrasing with downstream summaries, score the shift, and map into JPY and exporter proxies.",
    antiBotPolicy: [
      "Treat PDFs and archive hops as normal intermediate states.",
      "Slow down around document loads to avoid unnecessary retries.",
    ],
    fallbackPolicy: [
      "Return explicit unchanged-state JSON when no tone shift is found.",
      "Use archive listing metadata when document fetch fails.",
    ],
    guardrails: [
      "Keep this recipe paper-only until more live evidence lands.",
      "Skip oversized entries near scheduled central-bank events.",
    ],
    knownFailureModes: governmentRecipeById.get("jp-translation-drift")!.knownFailureModes,
    suggestedSkills: ["scan"],
    defaultVenueBias: "ibkr",
  },
  {
    ...governmentRecipeById.get("eu-energy-watch")!,
    id: "eu-energy-watch",
    title: "EU Energy Ministry Relay",
    subtitle: "Cross-country energy policy watchlist before sector repricing",
    description:
      "Track a multi-country official energy policy watchlist for surprise supply or subsidy language and route only after review confirms the signal is actionable.",
    category: "government",
    countries: governmentRecipeById.get("eu-energy-watch")!.countries,
    sources: getRecipeSources(governmentRecipeById.get("eu-energy-watch")!.sources),
    supportedVenues: governmentRecipeById.get("eu-energy-watch")!.supportedVenues,
    readiness: governmentRecipeById.get("eu-energy-watch")!.readiness,
    evidenceCount: governmentRecipeById.get("eu-energy-watch")!.evidenceCount,
    sampleSignalCount: 7,
    lastSuccessfulRunAt: governmentRecipeById.get("eu-energy-watch")!.lastSuccessfulRunAt,
    promptVersion: governmentRecipeById.get("eu-energy-watch")!.promptVersion,
    scoringModel: "tinyfish-signal-stack:v2",
    strategyOutline:
      "Run cross-country official-source scans in parallel, normalize policy language, and hold back from live routing until the evidence set is deeper.",
    antiBotPolicy: [
      "Prefer listing pages when ministry press pages resist direct access.",
      "Keep per-country tasks short to preserve stream stability.",
    ],
    fallbackPolicy: [
      "Return explicit empty-state JSON when the policy language is stale.",
      "Mark blocked countries without failing the whole run.",
    ],
    guardrails: [
      "Research-only recipe: no live routing.",
      "Require at least two confirming sources before escalating the score.",
    ],
    knownFailureModes: governmentRecipeById.get("eu-energy-watch")!.knownFailureModes,
    suggestedSkills: ["scan"],
    defaultVenueBias: "ibkr",
  },
  {
    id: "official-vs-polymarket",
    title: "Official vs Polymarket Divergence",
    subtitle: "Primary-source updates against live event pricing",
    description:
      "Compare official updates with prediction-market probability and only route when the mismatch survives review, market metadata checks, and venue constraints.",
    category: "prediction",
    countries: ["US", "GLOBAL"],
    sources: [
      {
        id: "cme-fedwatch",
        name: "CME FedWatch",
        url: "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
        country: "US",
        locale: "en",
        kind: "watchlist",
        status: "healthy",
        cadence: "event-driven",
      },
      {
        id: "sec-edgar",
        name: "SEC Edgar Search",
        url: "https://www.sec.gov/edgar/search/",
        country: "US",
        locale: "en",
        kind: "official",
        status: "healthy",
        cadence: "event-driven",
      },
      {
        id: "polymarket-meta",
        name: "Polymarket Market Metadata",
        url: "https://polymarket.com/",
        country: "GLOBAL",
        locale: "en",
        kind: "market",
        status: "healthy",
        cadence: "intra-day",
      },
    ],
    supportedVenues: ["polymarket"],
    readiness: "live-ready",
    evidenceCount: 14,
    sampleSignalCount: 31,
    lastSuccessfulRunAt: nowIso(-28),
    promptVersion: "hunt-poly-v4",
    scoringModel: "tinyfish-signal-stack:v2",
    strategyOutline:
      "Cross-check official resolution sources with live probability, score divergence, and route into Polymarket only when venue metadata is complete.",
    antiBotPolicy: [
      "Capture streaming URL on every run for replay.",
      "Keep fetch, search, and pricing tasks separate to reduce dwell time.",
    ],
    fallbackPolicy: [
      "Return blocked or empty-state JSON instead of silent nulls.",
      "Degrade to metadata-only review if the official source stalls.",
    ],
    guardrails: [
      "Require live market metadata and price before execution.",
      "Cancel stale live orders when divergence collapses.",
    ],
    knownFailureModes: [
      "Official source updated but not yet tradable.",
      "Prediction market depth too thin for live routing.",
    ],
    suggestedSkills: ["hunt"],
    defaultVenueBias: "polymarket",
  },
];

function recipeToStrategy(
  recipeId: string,
  options: {
    id: string;
    version: number;
    name: string;
    thesis: string;
    source?: "recipe" | "agent-generated";
    lastRunSummary?: string;
  },
): StrategyVersion {
  const recipe = RECIPE_REGISTRY.find((entry) => entry.id === recipeId) ?? RECIPE_REGISTRY[0];

  return {
    id: options.id,
    version: options.version,
    name: options.name,
    objective: recipe.description,
    thesis: options.thesis,
    riskProfile: recipe.readiness === "live-ready" ? "balanced" : "conservative",
    promptVersion: recipe.promptVersion,
    source: options.source ?? "recipe",
    runConfig: {
      recipeId: recipe.id,
      countries: recipe.countries,
      sources: recipe.sources.slice(0, 2).map((source) => source.id),
      skills: recipe.suggestedSkills,
      mode: "paper",
      execute: true,
      previewOnly: false,
      force: true,
      promptVersion: recipe.promptVersion,
      preferredVenue: recipe.defaultVenueBias,
    },
    venueMapping: recipe.supportedVenues.map((venue) => ({
      venue,
      instruments:
        venue === "ibkr"
          ? recipe.id === "jp-translation-drift"
            ? ["EWJ", "FXY", "TM"]
            : ["KWEB", "FXI", "MOS"]
          : ["Fed Rate Hold YES", "China Stimulus YES"],
      rationale:
        venue === "ibkr"
          ? "Liquid public-market proxy for policy or macro repricing."
          : "Event market where official-source confirmation moves the odds.",
    })),
    scoringRationale: [
      "Prompt hardening keeps source scope and fallback behavior explicit.",
      "Venue routing stays coupled to review score and recipe guardrails.",
      "Paper remains the default launch mode until the operator promotes live.",
    ],
    scorecard: [
      {
        label: "Evidence",
        score: Math.min(95, 70 + recipe.evidenceCount),
        note: `${recipe.evidenceCount} successful proof runs recorded in the registry.`,
      },
      {
        label: "Route Readiness",
        score: recipe.readiness === "live-ready" ? 89 : recipe.readiness === "paper-only" ? 72 : 61,
        note:
          recipe.readiness === "live-ready"
            ? "Live route can be armed after preflight."
            : recipe.readiness === "research-only"
              ? "Research-only until more evidence is collected."
              : "Demo-safe but not yet approved for live routing.",
      },
      {
        label: "Prompt Reuse",
        score: 83,
        note: `Prompt version ${recipe.promptVersion} is reusable and artifact-aware.`,
      },
    ],
    approvalState: recipe.readiness === "live-ready" ? "live-candidate" : "paper",
    createdAt: nowIso(-180),
    guardrails: recipe.guardrails,
    readiness: recipe.readiness,
    lastRunSummary: options.lastRunSummary,
  };
}

export function buildSeedConnections(): VenueConnection[] {
  return [
    {
      id: "ibkr-paper",
      venue: "ibkr",
      mode: "paper",
      label: "IBKR Paper",
      description: "Client Portal or gateway-backed paper routing for stock and ETF execution.",
      fields: {
        accountId: "DU2749603",
        gatewayUrl: "http://127.0.0.1:5000",
        apiToken: "paper-demo-token",
      },
      status: "ready",
      statusNote: "Paper routing available for recipe and agent runs.",
    },
    {
      id: "ibkr-live",
      venue: "ibkr",
      mode: "live",
      label: "IBKR Live",
      description: "Live broker connection with contract resolution and order preview gates.",
      fields: {
        accountId: "U1093829",
        gatewayUrl: "https://ibkr-gateway.tinyfish.local",
        apiToken: "",
      },
      status: "warning",
      statusNote: "Gateway reachable, but operator token is still missing for live routing.",
    },
    {
      id: "polymarket-paper",
      venue: "polymarket",
      mode: "paper",
      label: "Polymarket Paper",
      description: "Paper ledger for divergence validation before production routing.",
      fields: {
        gatewayUrl: "https://polymarket-gateway.tinyfish.local/orders",
        walletAddress: "0xF56E9C1Ea4D430c4208891aB73E127Cd1aFd0091",
        apiKey: "paper-simulated",
      },
      status: "ready",
      statusNote: "Paper fills simulate trade lifecycle and receipts.",
    },
    {
      id: "polymarket-live",
      venue: "polymarket",
      mode: "live",
      label: "Polymarket Live",
      description: "Two-layer auth flow with L1 wallet signing and L2 API credentials.",
      fields: {
        gatewayUrl: "https://polymarket-gateway.tinyfish.local/orders",
        walletAddress: "0xB857cf0dA1346fAb27B21d47b4b4aDAc88066431",
        apiKey: "pm-live-demo-key",
        apiSecret: "",
        passphrase: "",
        privateKey: "",
      },
      status: "warning",
      statusNote: "Live wallet is present, but L2 secret material is incomplete.",
    },
  ];
}

export function buildSeedStrategies(): StrategyVersion[] {
  return [
    recipeToStrategy("cn-policy-lag", {
      id: "strategy-mandarin-shock",
      version: 4,
      name: "Mandarin Policy Shock",
      thesis:
        "Official domestic language reaches the local market first and foreign repricing second. The edge is the lag between publication and cross-venue reaction.",
      lastRunSummary: "Last paper run filled KWEB and surfaced one Polymarket hedge.",
    }),
    recipeToStrategy("official-vs-polymarket", {
      id: "strategy-official-divergence",
      version: 2,
      name: "Official Source Divergence",
      thesis:
        "Primary-source confirmation can outrun event-market repricing when the market is anchored to stale odds.",
      lastRunSummary: "Latest run found a 4.2-point divergence and filled one paper YES ticket.",
    }),
    recipeToStrategy("jp-translation-drift", {
      id: "strategy-tokyo-drift",
      version: 1,
      name: "Tokyo Translation Drift",
      thesis:
        "Japanese-language releases can carry a clearer directional signal than the translated summary absorbed by US retail flow.",
      lastRunSummary: "Paper-only. Last run scored one exporter signal, no live promotion.",
    }),
  ];
}

export function buildSeedPositions(): Position[] {
  return [
    {
      id: "pos-kweb",
      strategyId: "strategy-mandarin-shock",
      strategyName: "Mandarin Policy Shock",
      venue: "ibkr",
      mode: "paper",
      symbolOrToken: "KWEB",
      direction: "long",
      quantity: 11.4,
      entryPrice: 26.31,
      markPrice: 27.04,
      exposureUsd: 300.35,
      realizedPnlUsd: 0,
      status: "open",
      updatedAt: nowIso(-2),
    },
    {
      id: "pos-fed-hold",
      strategyId: "strategy-official-divergence",
      strategyName: "Official Source Divergence",
      venue: "polymarket",
      mode: "paper",
      symbolOrToken: "Fed Rate Hold YES",
      direction: "yes",
      quantity: 508,
      entryPrice: 0.41,
      markPrice: 0.44,
      exposureUsd: 223.52,
      realizedPnlUsd: 0,
      status: "open",
      updatedAt: nowIso(-1),
    },
  ];
}
