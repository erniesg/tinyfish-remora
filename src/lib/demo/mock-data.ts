import type {
  Position,
  RecipePreset,
  StrategyVersion,
  VenueConnection,
} from "@/lib/demo/types";

function nowIso(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

export const RECIPES: RecipePreset[] = [
  {
    id: "ndrc-policy-lag",
    title: "Mandarin Policy Lag",
    subtitle: "NDRC and ministry bulletins before ADR repricing",
    description:
      "Monitor non-English official policy releases, expand bilingual keywords, score tradable policy shocks, then map the lag to China-sensitive equities and ETFs on IBKR.",
    sourceLocale: "zh-CN",
    defaultGoal:
      "Start at the official agency homepage, navigate like a human, extract only market-moving policy updates, and return structured JSON with ticker hints and sentiment.",
    antiBotPolicy: [
      "Use TinyFish stealth plus country-matched proxy for protected ministry sites.",
      "Handle cookie, consent, redirect, and security pages before extraction.",
      "Prefer homepage navigation over deep links when challenges appear.",
    ],
    fallbackPolicy: [
      "If blocked or empty, return structured fallback JSON with error and source attempted.",
      "Switch to related ministry RSS or mirrored release pages if available.",
    ],
    keywords: ["NDRC", "MOFCOM", "industrial policy", "export controls", "stimulus"],
    primaryVenue: "ibkr",
    venues: ["ibkr", "polymarket"],
    thesis:
      "Official domestic policy language reaches local-language readers first and equities second. The edge is the lag between bulletin publication and foreign market pricing.",
    parallelPlan: "Run 3 collectors in parallel: homepage watch, keyword expansion, and issuer impact map.",
    riskNote: "Keep exposure capped until review confirms the policy is both novel and tradable.",
  },
  {
    id: "boj-yen-lag",
    title: "BOJ Translation Drift",
    subtitle: "Japanese official language into FX and exporter risk",
    description:
      "Track Bank of Japan speeches and policy summaries, compare Japanese phrasing to English summaries, and trade the mismatch through FX-sensitive equities.",
    sourceLocale: "ja-JP",
    defaultGoal:
      "Read the latest BOJ release in Japanese, detect policy tone changes, and return JSON with FX-sensitive tickers, confidence, and a concise reason.",
    antiBotPolicy: [
      "Use numbered steps with deliberate pauses around PDF render and archive navigation.",
      "Treat PDF or redirect loads as expected intermediate states instead of failures.",
    ],
    fallbackPolicy: [
      "If the official page fails, use the BOJ archive listing and capture the last successful release metadata.",
      "Return null signal payloads explicitly when the release is unchanged.",
    ],
    keywords: ["BOJ", "yield curve control", "JPY", "inflation outlook", "policy board"],
    primaryVenue: "ibkr",
    venues: ["ibkr"],
    thesis:
      "Nuance is often lost in downstream summaries. The first readable Japanese release frequently contains the sharper signal for exporters and FX proxies.",
    parallelPlan: "Split work into release scrape, PDF tone extraction, and ticker sensitivity scoring.",
    riskNote: "Avoid oversized positions around scheduled central-bank events with headline saturation.",
  },
  {
    id: "polymarket-divergence",
    title: "Prediction Divergence",
    subtitle: "Official updates versus Polymarket probability drift",
    description:
      "Collate primary-source official updates, compare them with live prediction market pricing, and execute paper or live entries on Polymarket when the divergence widens.",
    sourceLocale: "multi-source",
    defaultGoal:
      "Collect the latest primary-source update, compare it with current market odds, and return a JSON trade candidate only when the mismatch is material.",
    antiBotPolicy: [
      "Capture the TinyFish streaming URL for operator replay every run.",
      "Prefer smaller, parallelized tasks to reduce dwell time and bot risk.",
      "Classify completed-but-empty runs as soft failures and retry with narrower scope.",
    ],
    fallbackPolicy: [
      "Fall back to alternate public sources or market metadata snapshots if the primary source blocks automation.",
      "Return explicit blocked/access_denied payloads instead of silent nulls.",
    ],
    keywords: ["Polymarket", "probability drift", "official confirmation", "event pricing", "latency"],
    primaryVenue: "polymarket",
    venues: ["polymarket"],
    thesis:
      "Prediction markets can overshoot or lag when official information arrives in fragments. Pairing primary-source extraction with market metadata makes the edge explainable.",
    parallelPlan: "Fan out official-source fetch, price sanity checks, and market metadata fetch in parallel.",
    riskNote: "Neg-risk flags, tick size, and timeout-based cancels must be known before live entry.",
  },
];

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
      statusNote: "Paper routing available for the demo.",
    },
    {
      id: "ibkr-live",
      venue: "ibkr",
      mode: "live",
      label: "IBKR Live",
      description: "Live broker connection with contract resolution and order preview gates.",
      fields: {
        accountId: "",
        gatewayUrl: "",
        apiToken: "",
      },
      status: "missing",
      statusNote: "Live disabled until account and gateway credentials are supplied.",
    },
    {
      id: "polymarket-paper",
      venue: "polymarket",
      mode: "paper",
      label: "Polymarket Paper",
      description: "Paper ledger for market-making and divergence validation before production routing.",
      fields: {
        walletAddress: "0xF56E9C1Ea4D430c4208891aB73E127Cd1aFd0091",
        apiKey: "paper-simulated",
      },
      status: "ready",
      statusNote: "Paper fills are being simulated inside the cockpit.",
    },
    {
      id: "polymarket-live",
      venue: "polymarket",
      mode: "live",
      label: "Polymarket Live",
      description: "Two-layer auth flow with L1 wallet signing and L2 API credentials.",
      fields: {
        walletAddress: "",
        apiKey: "",
        apiSecret: "",
        passphrase: "",
        privateKey: "",
      },
      status: "missing",
      statusNote: "Waiting for wallet, API key, API secret, passphrase, and signer key.",
    },
  ];
}

export function buildSeedStrategies(): StrategyVersion[] {
  return [
    {
      id: "strategy-mandarin-lag",
      version: 3,
      name: "Mandarin Policy Shock",
      source: "recipe",
      objective:
        "Turn non-English policy bulletins into tradable equity and prediction-market intents before US retail flow catches up.",
      thesis:
        "When the policy language is specific, first-order repricing tends to show up in liquid China-sensitive instruments and related prediction markets.",
      recipeIds: ["ndrc-policy-lag"],
      keywords: ["NDRC", "rare earths", "stimulus", "industrial policy"],
      universe: ["KWEB", "FXI", "BABA", "Alibaba revenue growth markets"],
      venues: ["ibkr", "polymarket"],
      riskProfile: "balanced",
      scoringModel: "tinyfish-signal-stack:v1",
      entryRules: [
        "Only enter when the official bulletin is new, material, and scored above 82/100.",
        "Require both keyword expansion and structured review to agree on direction.",
      ],
      exitRules: [
        "Exit after 90 minutes or once major English wire coverage arrives.",
        "Exit early if the confidence delta falls below 0.62.",
      ],
      risk: {
        perTradeMaxUsd: 750,
        dailyLossLimitUsd: 1500,
        maxOpenPositions: 3,
        slippageBpsLimit: 45,
      },
      execution: {
        mode: "paper",
        autoEntry: true,
        autoExit: true,
      },
      rationale: [
        "Built around TinyFish prompt hardening and a visible collect-review-decide-execute runtime loop.",
        "Keeps routing paper-first while still exposing the live controls in the same surface.",
      ],
      createdAt: nowIso(-250),
      lastRunLabel: "Filled 2 paper entries in the last batch.",
    },
    {
      id: "strategy-polymarket-divergence",
      version: 1,
      name: "Primary Source Divergence",
      source: "recipe",
      objective:
        "Compare primary-source updates against public probability curves and paper-trade the spread when the market is stale.",
      thesis:
        "Primary-source confirmation can outpace market repricing when the event is fragmented or localized.",
      recipeIds: ["polymarket-divergence"],
      keywords: ["official update", "probability drift", "confirmation", "market metadata"],
      universe: ["Fed 2026 cut probability", "election reform package approval"],
      venues: ["polymarket"],
      riskProfile: "conservative",
      scoringModel: "tinyfish-signal-stack:v1",
      entryRules: [
        "Need official-source extraction plus market metadata confirmation.",
        "Skip if tick size or neg-risk flags are unavailable.",
      ],
      exitRules: [
        "Cancel stale live orders after 45 seconds.",
        "Close paper positions once the official update is widely syndicated.",
      ],
      risk: {
        perTradeMaxUsd: 400,
        dailyLossLimitUsd: 900,
        maxOpenPositions: 2,
        slippageBpsLimit: 30,
      },
      execution: {
        mode: "paper",
        autoEntry: true,
        autoExit: true,
      },
      rationale: [
        "Keeps receipt, intent, and venue routing concerns explicit for Polymarket execution.",
      ],
      createdAt: nowIso(-120),
      lastRunLabel: "Paper preview completed with one high-confidence YES setup.",
    },
  ];
}

export function buildSeedPositions(): Position[] {
  return [
    {
      id: "pos-kweb",
      strategyId: "strategy-mandarin-lag",
      strategyName: "Mandarin Policy Shock",
      venue: "ibkr",
      mode: "paper",
      instrument: "KWEB",
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
      id: "pos-fed-yes",
      strategyId: "strategy-polymarket-divergence",
      strategyName: "Primary Source Divergence",
      venue: "polymarket",
      mode: "paper",
      instrument: "Fed Cut 2026 YES",
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
