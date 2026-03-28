import { RECIPE_REGISTRY } from "@/lib/demo/mock-data";
import type {
  AgentEvent,
  ExecutionIntent,
  ExecutionReceipt,
  ExecutionMode,
  GeneratedStrategyResponse,
  Position,
  RawSignal,
  RecipeDefinition,
  ReviewedInstrument,
  ReviewedSignal,
  RiskProfile,
  RunLaunchResponse,
  RunRequest,
  StrategyDraft,
  Venue,
  VenueCandidate,
  VenueConnection,
} from "@/lib/demo/types";

export type TimedEvent = AgentEvent & { delayMs: number };

function iso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function getRecipeDefinition(recipeId?: string): RecipeDefinition {
  return RECIPE_REGISTRY.find((recipe) => recipe.id === recipeId) ?? RECIPE_REGISTRY[0];
}

function normalizeVenueCandidate(
  value: VenueCandidate | undefined,
  recipe: RecipeDefinition,
): VenueCandidate {
  if (!value || value === "both") {
    return recipe.supportedVenues.length === 1 ? recipe.supportedVenues[0] : "both";
  }
  if (value === "ibkr" || value === "polymarket") {
    return recipe.supportedVenues.includes(value) ? value : recipe.defaultVenueBias;
  }
  return recipe.defaultVenueBias;
}

export function resolveRunRequest(request: Partial<RunRequest>): RunRequest {
  const recipe = getRecipeDefinition(request.recipeId);
  const requestedCountries = uniqueStrings(request.countries ?? []).filter((country) =>
    recipe.countries.includes(country),
  );
  const requestedSources = uniqueStrings(request.sources ?? []).filter((sourceId) =>
    recipe.sources.some((source) => source.id === sourceId),
  );

  return {
    recipeId: recipe.id,
    strategyId: request.strategyId,
    countries: requestedCountries.length > 0 ? requestedCountries : recipe.countries,
    sources:
      requestedSources.length > 0
        ? requestedSources
        : recipe.sources.slice(0, Math.min(2, recipe.sources.length)).map((source) => source.id),
    strategyBrief: request.strategyBrief?.trim() || undefined,
    skills: request.skills?.length ? request.skills : recipe.suggestedSkills,
    mode: request.mode ?? "paper",
    execute: request.execute ?? true,
    previewOnly: request.previewOnly ?? false,
    force: request.force ?? true,
    promptVersion: request.promptVersion || recipe.promptVersion,
    preferredVenue: normalizeVenueCandidate(request.preferredVenue, recipe),
  };
}

function encodeList(values: string[] | undefined): string {
  return (values ?? []).join(",");
}

function decodeList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildRunLaunch(request: Partial<RunRequest>): RunLaunchResponse {
  const normalized = resolveRunRequest(request);
  const recipe = getRecipeDefinition(normalized.recipeId);
  const runId = makeId(slugify(recipe.title));
  const params = new URLSearchParams({
    recipeId: normalized.recipeId ?? recipe.id,
    mode: normalized.mode,
    execute: normalized.execute ? "1" : "0",
    previewOnly: normalized.previewOnly ? "1" : "0",
    force: normalized.force ? "1" : "0",
    promptVersion: normalized.promptVersion ?? recipe.promptVersion,
    preferredVenue: normalized.preferredVenue ?? recipe.defaultVenueBias,
  });

  if (normalized.strategyId) params.set("strategyId", normalized.strategyId);
  if (normalized.strategyBrief) params.set("strategyBrief", normalized.strategyBrief);
  if (normalized.countries?.length) params.set("countries", encodeList(normalized.countries));
  if (normalized.sources?.length) params.set("sources", encodeList(normalized.sources));
  if (normalized.skills?.length) params.set("skills", encodeList(normalized.skills));

  return {
    runId,
    label: normalized.strategyBrief ? "Agent Thesis Run" : recipe.title,
    request: normalized,
    streamUrl: `/api/demo/stream/${runId}?${params.toString()}`,
    streamingUrl: `https://stream.agent.tinyfish.ai/demo/${runId}`,
  };
}

export function parseRunRequestFromUrl(url: URL): RunRequest {
  return resolveRunRequest({
    recipeId: url.searchParams.get("recipeId") || undefined,
    strategyId: url.searchParams.get("strategyId") || undefined,
    strategyBrief: url.searchParams.get("strategyBrief") || undefined,
    countries: decodeList(url.searchParams.get("countries")),
    sources: decodeList(url.searchParams.get("sources")),
    skills: decodeList(url.searchParams.get("skills")) as Array<"scan" | "hunt">,
    mode: (url.searchParams.get("mode") as ExecutionMode | null) ?? "paper",
    execute: url.searchParams.get("execute") !== "0",
    previewOnly: url.searchParams.get("previewOnly") === "1",
    force: url.searchParams.get("force") !== "0",
    promptVersion: url.searchParams.get("promptVersion") || undefined,
    preferredVenue: (url.searchParams.get("preferredVenue") as VenueCandidate | null) ?? undefined,
  });
}

export function assessConnection(connection: VenueConnection): VenueConnection {
  const requiredFields =
    connection.venue === "ibkr"
      ? connection.mode === "paper"
        ? ["accountId", "gatewayUrl"]
        : ["accountId", "gatewayUrl", "apiToken"]
      : connection.mode === "paper"
        ? ["walletAddress", "gatewayUrl"]
        : ["walletAddress", "gatewayUrl", "apiKey", "apiSecret", "passphrase", "privateKey"];

  const missing = requiredFields.filter((field) => !connection.fields[field]?.trim());

  if (missing.length === 0) {
    return {
      ...connection,
      status: connection.mode === "live" ? "warning" : "ready",
      statusNote:
        connection.mode === "live"
          ? "Live credentials loaded. Keep confirmation gates enabled."
          : "Ready for immediate paper execution.",
    };
  }

  return {
    ...connection,
    status: missing.length === requiredFields.length ? "missing" : "warning",
    statusNote: `Missing ${missing.join(", ")}.`,
  };
}

function resolveInstrumentBundle(
  recipe: RecipeDefinition,
  preferredVenue: VenueCandidate,
  country: string,
): Array<{ venue: Venue; symbolOrToken: string; label: string; direction: ReviewedSignal["direction"] }> {
  const allowBoth = preferredVenue === "both" || preferredVenue === undefined;

  if (recipe.id === "official-vs-polymarket") {
    return [
      {
        venue: "polymarket",
        symbolOrToken: "pm-fed-hold-yes",
        label: "Fed Rate Hold YES",
        direction: "yes",
      },
    ];
  }

  if (recipe.id === "jp-translation-drift") {
    return [
      {
        venue: "ibkr",
        symbolOrToken: "EWJ",
        label: "EWJ",
        direction: "short",
      },
    ];
  }

  if (recipe.id === "eu-energy-watch") {
    return [
      {
        venue: "ibkr",
        symbolOrToken: country === "DE" ? "VGK" : "IEUR",
        label: country === "DE" ? "VGK" : "IEUR",
        direction: "long",
      },
    ];
  }

  const bundle = [
    {
      venue: "ibkr" as const,
      symbolOrToken: country === "CN" ? "KWEB" : "FXI",
      label: country === "CN" ? "KWEB" : "FXI",
      direction: "long" as const,
    },
    {
      venue: "polymarket" as const,
      symbolOrToken: "pm-china-stimulus-yes",
      label: "China Stimulus YES",
      direction: "yes" as const,
    },
  ];

  if (allowBoth) return bundle;
  return bundle.filter((entry) => entry.venue === preferredVenue);
}

export function buildRawSignals(
  runId: string,
  recipe: RecipeDefinition,
  request: RunRequest,
): RawSignal[] {
  const activeCountries = request.countries?.length ? request.countries : recipe.countries;
  const activeSources = recipe.sources.filter((source) => request.sources?.includes(source.id));

  return activeSources.slice(0, 3).map((source, index) => {
    const country = activeCountries[index % activeCountries.length] ?? source.country;
    const seed = hashString(`${runId}-${recipe.id}-${source.id}-${country}`);
    const directionBundle = resolveInstrumentBundle(
      recipe,
      request.preferredVenue ?? recipe.defaultVenueBias,
      country,
    )[0];
    const sentiment = directionBundle?.direction === "short" || directionBundle?.direction === "no"
      ? "bearish"
      : "bullish";

    return {
      id: makeId("raw"),
      runId,
      recipeId: recipe.id,
      kind: recipe.category === "prediction" ? "prediction" : "policy",
      source: source.name,
      sourceId: source.id,
      sourceUrl: source.url,
      publishedAt: iso(-(seed % 4800)),
      title:
        recipe.id === "official-vs-polymarket"
          ? "Primary source update is ahead of event-market pricing"
          : `${country} official language changed before broad market coverage`,
      summary:
        recipe.id === "official-vs-polymarket"
          ? "Official resolution source and live market odds drifted apart long enough to justify review."
          : `${source.name} published market-relevant language before the secondary translation or English wire moved.`,
      fingerprint: `${recipe.id}-${source.id}-${country}-${seed}`.slice(0, 54),
      country,
      language: source.locale,
      tradableHints: {
        venueHint: request.preferredVenue ?? recipe.defaultVenueBias,
        ticker: directionBundle?.venue === "ibkr" ? directionBundle.symbolOrToken : undefined,
        marketSlug:
          directionBundle?.venue === "polymarket"
            ? directionBundle.symbolOrToken.replace(/^pm-/, "")
            : undefined,
        sentiment,
        resolutionSourceUrl: recipe.category === "prediction" ? source.url : undefined,
        country,
      },
      metadata: {
        promptVersion: request.promptVersion ?? recipe.promptVersion,
        evidenceCount: recipe.evidenceCount,
        sourceStatus: source.status,
      },
    };
  });
}

export function buildReviewedSignal(
  rawSignal: RawSignal,
  recipe: RecipeDefinition,
  request: RunRequest,
): ReviewedSignal {
  const seed = hashString(rawSignal.fingerprint);
  const reviewScore = clamp(74 + (seed % 20), 74, 94);
  const confidence = clamp(reviewScore / 100, 0.68, 0.95);
  const bundle = resolveInstrumentBundle(
    recipe,
    request.preferredVenue ?? recipe.defaultVenueBias,
    rawSignal.country,
  );

  const direction = bundle[0]?.direction ?? "long";
  const instruments: ReviewedInstrument[] = bundle.map((entry) => {
    const metadata: Record<string, string | number | boolean | null> =
      entry.venue === "polymarket"
        ? {
            price: 0.42 + (seed % 10) / 100,
            marketPrice: 0.42 + (seed % 10) / 100,
          }
        : {
            lastPrice: 25 + (seed % 600) / 20,
          };

    return {
      venue: entry.venue,
      symbolOrToken: entry.symbolOrToken,
      label: entry.label,
      marketSlug: entry.venue === "polymarket" ? entry.symbolOrToken.replace(/^pm-/, "") : undefined,
      sideHint: entry.direction === "short" || entry.direction === "no" ? "sell" : "buy",
      metadata,
    };
  });

  return {
    fingerprint: rawSignal.fingerprint,
    tradable: recipe.readiness !== "research" || request.mode === "paper",
    venueCandidates:
      instruments.length === 2
        ? "both"
        : (instruments[0]?.venue ?? "none"),
    instrumentCandidates: instruments,
    direction,
    confidence,
    reviewScore,
    horizonHours: recipe.category === "prediction" ? 24 : 48,
    entryWindowHours: recipe.category === "prediction" ? 4 : 6,
    exitPlan: {
      rule: recipe.category === "prediction" ? "time_stop" : "coverage_arrival",
      horizonHours: recipe.category === "prediction" ? 24 : 48,
      entryWindowHours: recipe.category === "prediction" ? 4 : 6,
      notes:
        recipe.category === "prediction"
          ? "Exit if the divergence collapses or the time stop hits."
          : "Exit on first broad English-language coverage or horizon breach.",
    },
    thesis:
      recipe.category === "prediction"
        ? "Primary-source confirmation is ahead of the quoted event-market probability."
        : "Primary-language policy language is ahead of secondary-market repricing.",
    constraintsApplied: [
      request.mode === "live" ? "live_confirmation_required" : "paper_default",
      `prompt_${request.promptVersion ?? recipe.promptVersion}`,
    ],
    reasoning:
      recipe.category === "prediction"
        ? "Market metadata and official-source timing align with a tradable divergence."
        : "The official-source delta is novel, source-backed, and venue-mapped.",
    source: rawSignal.source,
    title: rawSignal.title,
  };
}

function priceForInstrument(symbolOrToken: string, venue: Venue): number {
  const seed = hashString(symbolOrToken);
  if (venue === "ibkr") {
    return 18 + (seed % 1700) / 100;
  }
  return 0.31 + (seed % 38) / 100;
}

export function buildIntent(
  reviewedSignal: ReviewedSignal,
  instrument: ReviewedInstrument,
  request: RunRequest,
): ExecutionIntent {
  const notionalUsd = request.mode === "live"
    ? instrument.venue === "ibkr"
      ? 1250
      : 700
    : instrument.venue === "ibkr"
      ? 750
      : 400;

  return {
    reviewFingerprint: reviewedSignal.fingerprint,
    venue: instrument.venue,
    mode: request.mode,
    symbolOrToken: instrument.symbolOrToken,
    side: instrument.sideHint ?? "buy",
    notionalUsd,
    maxSlippageBps: instrument.venue === "ibkr" ? 45 : 30,
    expiresAt: iso((reviewedSignal.entryWindowHours ?? 4) * 60 * 60),
    exitPlan: reviewedSignal.exitPlan!,
    thesis: reviewedSignal.thesis,
    label: instrument.label,
    marketSlug: instrument.marketSlug,
    previewOnly: request.previewOnly,
    metadata: instrument.metadata,
  };
}

export function buildReceipt(
  intent: ExecutionIntent,
  request: RunRequest,
): ExecutionReceipt {
  const fillPrice = priceForInstrument(intent.symbolOrToken, intent.venue);
  const filledQuantity = Number(
    (intent.notionalUsd / fillPrice).toFixed(intent.venue === "ibkr" ? 2 : 0),
  );
  const status = request.previewOnly
    ? "preview"
    : request.mode === "live"
      ? "submitted"
      : "filled";

  return {
    venue: intent.venue,
    mode: request.mode,
    status,
    symbolOrToken: intent.symbolOrToken,
    side: intent.side,
    notionalUsd: intent.notionalUsd,
    receiptId: makeId("receipt"),
    submittedAt: iso(),
    filledPrice: Number(fillPrice.toFixed(intent.venue === "ibkr" ? 2 : 3)),
    filledQuantity,
    message:
      status === "submitted"
        ? "Live order handed to venue routing with confirmation gates intact."
        : status === "preview"
          ? "Preview receipt created without sending the order."
          : "Paper execution filled and now contributes to live P&L simulation.",
  };
}

export function buildPosition(
  intent: ExecutionIntent,
  receipt: ExecutionReceipt,
  strategyId: string | undefined,
  strategyName: string,
): Position {
  const markDelta = intent.venue === "ibkr" ? 0.72 : 0.03;
  const filledPrice = receipt.filledPrice ?? 0;
  const filledQuantity = receipt.filledQuantity ?? 0;
  const direction =
    intent.venue === "polymarket"
      ? intent.side === "sell"
        ? "no"
        : "yes"
      : intent.side === "sell"
        ? "short"
        : "long";

  return {
    id: makeId("position"),
    strategyId: strategyId || `recipe-${strategyName.toLowerCase().replace(/\s+/g, "-")}`,
    strategyName,
    venue: intent.venue,
    mode: intent.mode,
    symbolOrToken: intent.symbolOrToken,
    direction,
    quantity: filledQuantity,
    entryPrice: filledPrice,
    markPrice: Number((filledPrice + markDelta).toFixed(intent.venue === "ibkr" ? 2 : 3)),
    exposureUsd: Number((filledPrice * filledQuantity).toFixed(2)),
    realizedPnlUsd: 0,
    status: "open",
    updatedAt: iso(),
  };
}

export function buildBlockedTimeline(
  runId: string,
  recipe: RecipeDefinition,
  request: RunRequest,
  reason: string,
): TimedEvent[] {
  return [
    {
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "STARTED",
      timestamp: iso(),
      message: `${recipe.title} started for ${request.mode} routing.`,
      progress: 8,
      meta: {
        prompt_version: request.promptVersion ?? recipe.promptVersion,
      },
      delayMs: 250,
    },
    {
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "BLOCKED",
      timestamp: iso(1),
      message: reason,
      progress: 44,
      meta: {
        fallback_state: "blocked",
      },
      delayMs: 400,
    },
    {
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "COMPLETE",
      timestamp: iso(2),
      message: "Run ended with explicit fallback state.",
      progress: 100,
      meta: {
        fallback_state: "blocked",
      },
      delayMs: 200,
    },
  ];
}

export function buildRunTimeline(runId: string, requestInput: RunRequest): TimedEvent[] {
  const request = resolveRunRequest(requestInput);
  const recipe = getRecipeDefinition(request.recipeId);
  const selectedSources = recipe.sources.filter((source) => request.sources?.includes(source.id));

  if (request.mode === "live" && recipe.readiness !== "live-ready") {
    return buildBlockedTimeline(
      runId,
      recipe,
      request,
      `${recipe.title} is ${recipe.readiness}. Keep it in paper until the recipe is promoted.`,
    );
  }

  if (selectedSources.length === 0) {
    return buildBlockedTimeline(
      runId,
      recipe,
      request,
      "No sources selected. The run returned an explicit empty-state fallback.",
    );
  }

  const rawSignals = buildRawSignals(runId, recipe, request);

  if (rawSignals.length === 0) {
    return buildBlockedTimeline(
      runId,
      recipe,
      request,
      "Source fanout completed, but no new tradable signals were produced.",
    );
  }

  const reviewedSignals = rawSignals.map((rawSignal) => buildReviewedSignal(rawSignal, recipe, request));
  const firstReviewed = reviewedSignals[0];
  const activeInstruments = firstReviewed.instrumentCandidates.slice(
    0,
    recipe.category === "prediction" ? 1 : 2,
  );
  const intents = activeInstruments.map((instrument) => buildIntent(firstReviewed, instrument, request));
  const receipts = request.execute ? intents.map((intent) => buildReceipt(intent, request)) : [];
  const positions = receipts.map((receipt, index) =>
    buildPosition(intents[index], receipt, request.strategyId, request.strategyBrief || recipe.title),
  );

  const timeline: TimedEvent[] = [
    {
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "STARTED",
      timestamp: iso(),
      message: `${recipe.title} booted for ${request.mode}. Countries: ${request.countries?.join(", ") ?? recipe.countries.join(", ")}.`,
      progress: 6,
      meta: {
        prompt_version: request.promptVersion ?? recipe.promptVersion,
        readiness: recipe.readiness,
      },
      delayMs: 220,
    },
    {
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "STREAMING_URL",
      timestamp: iso(1),
      message: "TinyFish streaming URL captured for replay.",
      progress: 12,
      meta: {
        streaming_url: `https://stream.agent.tinyfish.ai/demo/${runId}`,
        countries: request.countries?.join(", ") ?? recipe.countries.join(", "),
        source_count: selectedSources.length,
      },
      delayMs: 320,
    },
  ];

  selectedSources.forEach((source, index) => {
    const progress = 18 + Math.round(((index + 1) / selectedSources.length) * 22);
    timeline.push({
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "SOURCE_PROGRESS",
      timestamp: iso(index + 2),
      message: `Scanning ${source.name} with ${source.status === "fragile" ? "fallback-aware" : "primary"} prompt flow.`,
      progress,
      meta: {
        source_id: source.id,
        source_name: source.name,
        country: source.country,
        index: index + 1,
        total: selectedSources.length,
      },
      delayMs: 440,
    });
  });

  rawSignals.forEach((rawSignal, index) => {
    timeline.push({
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "RAW_SIGNAL",
      timestamp: iso(index + 5),
      message: `${rawSignal.title} from ${rawSignal.source}.`,
      progress: 48 + index * 8,
      rawSignal,
      delayMs: 520,
    });
  });

  reviewedSignals.forEach((reviewedSignal, index) => {
    timeline.push({
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "REVIEWED_SIGNAL",
      timestamp: iso(index + 7),
      message: `Reviewed ${reviewedSignal.title} at ${reviewedSignal.reviewScore}/100 with ${(reviewedSignal.confidence * 100).toFixed(0)}% confidence.`,
      progress: 70 + index * 5,
      reviewedSignal,
      delayMs: 580,
    });
  });

  intents.forEach((intent, index) => {
    timeline.push({
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "DECISION",
      timestamp: iso(index + 9),
      message: `${request.mode === "live" ? "Live" : "Paper"} intent created for ${intent.label} on ${intent.venue.toUpperCase()}.`,
      progress: 84 + index * 4,
      intent,
      delayMs: 460,
    });
  });

  receipts.forEach((receipt, index) => {
    timeline.push({
      id: makeId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "RECEIPT",
      timestamp: iso(index + 11),
      message: receipt.message ?? "Execution receipt emitted.",
      progress: 94,
      receipt,
      position: positions[index],
      delayMs: 600,
    });
  });

  timeline.push({
    id: makeId("evt"),
    runId,
    recipeId: recipe.id,
    strategyId: request.strategyId,
    phase: "COMPLETE",
    timestamp: iso(14),
    message:
      receipts.length > 0
        ? `${recipe.title} complete. ${receipts.length} receipt${receipts.length > 1 ? "s" : ""} emitted.`
        : `${recipe.title} complete with review only.`,
    progress: 100,
    meta: {
      recipe_id: recipe.id,
      signal_count: rawSignals.length,
      receipt_count: receipts.length,
    },
    delayMs: 260,
  });

  return timeline;
}

function countKeywordMatches(value: string, terms: string[]): number {
  return terms.reduce((score, term) => (value.includes(term) ? score + 1 : score), 0);
}

function analyzeObjectiveIntent(objective: string) {
  const normalized = objective.toLowerCase();
  const hasGovernmentIntent =
    countKeywordMatches(normalized, [
      "government",
      "policy",
      "official",
      "ministry",
      "release",
      "bulletin",
      "translation",
      "central bank",
      "regulation",
    ]) > 0;
  const hasPredictionIntent =
    countKeywordMatches(normalized, [
      "prediction",
      "polymarket",
      "event market",
      "probability",
      "odds",
      "repricing",
      "market pricing",
    ]) > 0;

  return {
    normalized,
    hasGovernmentIntent,
    hasPredictionIntent,
    hasChinaIntent:
      countKeywordMatches(normalized, [
        "china",
        "chinese",
        "mandarin",
        "adr",
        "stimulus",
        "beijing",
        "ndrc",
        "mofcom",
        "miit",
      ]) > 0,
    hasJapanIntent:
      countKeywordMatches(normalized, ["japan", "boj", "yen", "tokyo", "japanese"]) > 0,
    hasEuropeIntent:
      countKeywordMatches(normalized, ["europe", "eu", "germany", "france", "italy", "energy"]) > 0,
    hasFedIntent:
      countKeywordMatches(normalized, ["fed", "fomc", "sec", "resolution", "event pricing"]) > 0,
  };
}

function classifyObjective(objective: string): RecipeDefinition {
  const intent = analyzeObjectiveIntent(objective);
  const recipeScores = [
    {
      recipeId: "cn-policy-lag",
      score:
        countKeywordMatches(intent.normalized, [
          "china",
          "chinese",
          "mandarin",
          "adr",
          "stimulus",
          "beijing",
          "ministry",
          "policy",
          "official",
        ]) +
        (intent.hasGovernmentIntent ? 2 : 0) +
        (intent.hasChinaIntent ? 3 : 0) +
        (intent.hasGovernmentIntent && intent.hasPredictionIntent ? 4 : 0),
    },
    {
      recipeId: "official-vs-polymarket",
      score:
        countKeywordMatches(intent.normalized, [
          "prediction",
          "polymarket",
          "event market",
          "probability",
          "odds",
          "fed",
          "sec",
          "resolution",
        ]) +
        (intent.hasPredictionIntent ? 3 : 0) +
        (intent.hasFedIntent ? 2 : 0) -
        (intent.hasChinaIntent && intent.hasGovernmentIntent ? 2 : 0),
    },
    {
      recipeId: "jp-translation-drift",
      score:
        countKeywordMatches(intent.normalized, ["japan", "boj", "yen", "tokyo", "japanese", "translation"]) +
        (intent.hasJapanIntent ? 3 : 0) +
        (intent.hasGovernmentIntent ? 1 : 0),
    },
    {
      recipeId: "eu-energy-watch",
      score:
        countKeywordMatches(intent.normalized, ["europe", "eu", "germany", "france", "italy", "energy"]) +
        (intent.hasEuropeIntent ? 3 : 0) +
        (intent.hasGovernmentIntent ? 1 : 0),
    },
  ].sort((left, right) => right.score - left.score);

  if (recipeScores[0]?.score > 0) {
    return getRecipeDefinition(recipeScores[0].recipeId);
  }

  return getRecipeDefinition("cn-policy-lag");
}

function riskTemplate(riskProfile: RiskProfile): number {
  if (riskProfile === "aggressive") return 90;
  if (riskProfile === "conservative") return 72;
  return 82;
}

export function generateStrategyFromBrief(
  objective: string,
  riskProfile: RiskProfile,
  preferredVenue: VenueCandidate,
): GeneratedStrategyResponse {
  const recipe = classifyObjective(objective);
  const intent = analyzeObjectiveIntent(objective);
  const venueBias = normalizeVenueCandidate(preferredVenue, recipe);
  const selectedSources = recipe.sources.slice(0, 2).map((source) => source.id);
  const baseInstruments = resolveInstrumentBundle(recipe, venueBias, recipe.countries[0]);
  const nameSeed = objective
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .slice(0, 2)
    .join(" ");

  const draft: StrategyDraft = {
    id: makeId("draft"),
    name: nameSeed
      ? `Autonomous ${nameSeed.replace(/\b\w/g, (character) => character.toUpperCase())}`
      : "Autonomous Alpha Hunt",
    objective,
    thesis:
      recipe.category === "prediction"
        ? "Use primary-source confirmation to challenge stale event-market pricing and route only after review validates the divergence."
        : "Use primary-language or official-source monitoring to surface policy deltas before broad market repricing closes the lag.",
    riskProfile,
    promptVersion: recipe.promptVersion,
    source: "agent-generated",
    runConfig: {
      recipeId: recipe.id,
      countries: recipe.countries,
      sources: selectedSources,
      strategyBrief: objective,
      skills: recipe.suggestedSkills,
      mode: "paper",
      execute: true,
      previewOnly: false,
      force: true,
      promptVersion: recipe.promptVersion,
      preferredVenue: venueBias,
    },
    venueMapping: uniqueVenueMapping(baseInstruments),
    scoringRationale: [
      intent.hasGovernmentIntent && intent.hasPredictionIntent && recipe.id === "cn-policy-lag"
        ? `Selected ${recipe.title} because the objective is government-first but still wants a prediction-market hedge.`
        : `Selected ${recipe.title} because its sources and venues match the objective.`,
      "Kept the generated thesis on paper by default so the operator can review before promotion.",
      "Reused existing prompt, source, and scoring seams instead of inventing a parallel schema.",
    ],
    scorecard: [
      {
        label: "Thesis Fit",
        score: riskTemplate(riskProfile),
        note: `Objective aligned to ${recipe.title} and prompt ${recipe.promptVersion}.`,
      },
      {
        label: "Recipe Evidence",
        score: Math.min(94, 68 + recipe.evidenceCount),
        note: `${recipe.evidenceCount} successful registry proofs back this run shape.`,
      },
      {
        label: "Live Readiness",
        score: recipe.readiness === "live-ready" ? 87 : recipe.readiness === "demo" ? 69 : 54,
        note:
          recipe.readiness === "live-ready"
            ? "Can be promoted later after preflight and operator approval."
            : "Starts paper-only until more proof is collected.",
      },
    ],
    approvalState: "paper",
    createdAt: new Date().toISOString(),
  };

  return {
    draft,
    reasoning: [
      intent.hasGovernmentIntent && intent.hasPredictionIntent && recipe.id === "cn-policy-lag"
        ? "The classifier treated prediction-market language as a venue hedge instead of abandoning the government-policy collector."
        : "The agent reused a proven recipe rather than inventing an unbounded source graph.",
      "Countries, sources, skills, prompt version, and venue bias are embedded directly in the generated run config.",
      "The saved draft is rerunnable because the same RunRequest contract can be passed back into launch and stream.",
    ],
  };
}

function uniqueVenueMapping(
  instruments: Array<{ venue: Venue; symbolOrToken: string; label: string }>,
): StrategyDraft["venueMapping"] {
  return Array.from(new Set(instruments.map((item) => item.venue))).map((venue) => ({
    venue,
    instruments: instruments
      .filter((item) => item.venue === venue)
      .map((item) => item.label),
    rationale:
      venue === "ibkr"
        ? "Use liquid public-market proxies when the thesis maps cleanly into listed instruments."
        : "Use event contracts when the official-source edge is better expressed as a probability trade.",
  }));
}
