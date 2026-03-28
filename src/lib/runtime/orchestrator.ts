import "server-only";

import {
  buildBlockedTimeline,
  buildIntent,
  buildPosition,
  buildRawSignals,
  buildReceipt,
  buildReviewedSignal,
  getRecipeDefinition,
  resolveRunRequest,
  type TimedEvent,
} from "@/lib/demo/engine";
import type {
  ExecutionIntent,
  ExecutionReceipt,
  Position,
  RawSignal,
  RecipeDefinition,
  ReviewedSignal,
  RunRequest,
} from "@/lib/demo/types";
import { getRuntimeConfig } from "@/lib/runtime/env";
import { postRuntimeJson, postRuntimeRecords } from "@/lib/runtime/http";

function iso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function makeEventId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringCandidate(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) return value;
  }

  return undefined;
}

function normalizeMetadata(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isRecord(value)) return undefined;

  const next = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      return (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        entry === null
      );
    }),
  ) as Record<string, string | number | boolean | null>;

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeRawSignal(value: unknown, fallback: RawSignal): RawSignal {
  if (!isRecord(value)) return fallback;

  const tradableHints = isRecord(value.tradableHints)
    ? {
        ...fallback.tradableHints,
        venueHint:
          value.tradableHints.venueHint === "ibkr" ||
          value.tradableHints.venueHint === "polymarket" ||
          value.tradableHints.venueHint === "both" ||
          value.tradableHints.venueHint === "none"
            ? value.tradableHints.venueHint
            : fallback.tradableHints?.venueHint,
        ticker: readString(value.tradableHints, "ticker") ?? fallback.tradableHints?.ticker,
        marketSlug: readString(value.tradableHints, "marketSlug") ?? fallback.tradableHints?.marketSlug,
        sentiment:
          value.tradableHints.sentiment === "bullish" ||
          value.tradableHints.sentiment === "bearish" ||
          value.tradableHints.sentiment === "neutral"
            ? value.tradableHints.sentiment
            : fallback.tradableHints?.sentiment,
        resolutionSourceUrl:
          readString(value.tradableHints, "resolutionSourceUrl") ?? fallback.tradableHints?.resolutionSourceUrl,
        country: readString(value.tradableHints, "country") ?? fallback.tradableHints?.country,
      }
    : fallback.tradableHints;

  return {
    ...fallback,
    id: readString(value, "id") ?? fallback.id,
    runId: readString(value, "runId") ?? fallback.runId,
    recipeId: readString(value, "recipeId") ?? fallback.recipeId,
    kind: value.kind === "prediction" || value.kind === "policy" ? value.kind : fallback.kind,
    source: readString(value, "source") ?? fallback.source,
    sourceId: readString(value, "sourceId") ?? fallback.sourceId,
    sourceUrl: readString(value, "sourceUrl") ?? fallback.sourceUrl,
    publishedAt: readString(value, "publishedAt") ?? fallback.publishedAt,
    title: readString(value, "title") ?? fallback.title,
    summary: readString(value, "summary") ?? fallback.summary,
    fingerprint: readString(value, "fingerprint") ?? fallback.fingerprint,
    country: readString(value, "country") ?? fallback.country,
    language: readString(value, "language") ?? fallback.language,
    tradableHints,
    metadata: {
      ...(fallback.metadata ?? {}),
      ...(normalizeMetadata(value.metadata) ?? {}),
    },
  };
}

function normalizeReviewedSignal(value: unknown, fallback: ReviewedSignal): ReviewedSignal {
  if (!isRecord(value)) return fallback;

  const fallbackInstruments = fallback.instrumentCandidates;
  const instrumentCandidates = Array.isArray(value.instrumentCandidates) && value.instrumentCandidates.length > 0
    ? value.instrumentCandidates.map((candidate, index) => {
        if (!isRecord(candidate)) {
          return (
            fallbackInstruments[index] ??
            fallbackInstruments[0] ?? {
              venue: "polymarket" as const,
              symbolOrToken: `candidate-${index + 1}`,
              label: `Candidate ${index + 1}`,
            }
          );
        }

        const base = fallbackInstruments[index] ?? fallbackInstruments[0] ?? {
          venue:
            candidate.venue === "ibkr" || candidate.venue === "polymarket"
              ? candidate.venue
              : "polymarket",
          symbolOrToken:
            readString(candidate, "symbolOrToken") ??
            readString(candidate, "marketSlug") ??
            `candidate-${index + 1}`,
          label:
            readString(candidate, "label") ??
            readString(candidate, "symbolOrToken") ??
            readString(candidate, "marketSlug") ??
            `Candidate ${index + 1}`,
          marketSlug: readString(candidate, "marketSlug"),
          sideHint:
            candidate.sideHint === "buy" || candidate.sideHint === "sell"
              ? candidate.sideHint
              : undefined,
          metadata: normalizeMetadata(candidate.metadata),
        };

        return {
          ...base,
          venue:
            candidate.venue === "ibkr" || candidate.venue === "polymarket"
              ? candidate.venue
              : base.venue,
          symbolOrToken: readString(candidate, "symbolOrToken") ?? base.symbolOrToken,
          label: readString(candidate, "label") ?? base.label,
          marketSlug: readString(candidate, "marketSlug") ?? base.marketSlug,
          sideHint:
            candidate.sideHint === "buy" || candidate.sideHint === "sell"
              ? candidate.sideHint
              : base.sideHint,
          metadata: {
            ...(base.metadata ?? {}),
            ...(normalizeMetadata(candidate.metadata) ?? {}),
          },
        };
      })
    : fallbackInstruments;

  return {
    ...fallback,
    fingerprint: readString(value, "fingerprint") ?? fallback.fingerprint,
    tradable: readBoolean(value, "tradable") ?? fallback.tradable,
    venueCandidates:
      value.venueCandidates === "ibkr" ||
      value.venueCandidates === "polymarket" ||
      value.venueCandidates === "both" ||
      value.venueCandidates === "none"
        ? value.venueCandidates
        : fallback.venueCandidates,
    instrumentCandidates,
    direction:
      value.direction === "long" ||
      value.direction === "short" ||
      value.direction === "yes" ||
      value.direction === "no" ||
      value.direction === "none"
        ? value.direction
        : fallback.direction,
    confidence: readNumber(value, "confidence") ?? fallback.confidence,
    reviewScore: readNumber(value, "reviewScore") ?? fallback.reviewScore,
    horizonHours: readNumber(value, "horizonHours") ?? fallback.horizonHours,
    entryWindowHours: readNumber(value, "entryWindowHours") ?? fallback.entryWindowHours,
    thesis: readString(value, "thesis") ?? fallback.thesis,
    reasoning: readString(value, "reasoning") ?? fallback.reasoning,
    source: readString(value, "source") ?? fallback.source,
    title: readString(value, "title") ?? fallback.title,
    constraintsApplied:
      Array.isArray(value.constraintsApplied) && value.constraintsApplied.every((entry) => typeof entry === "string")
        ? value.constraintsApplied
        : fallback.constraintsApplied,
    exitPlan:
      isRecord(value.exitPlan) && fallback.exitPlan
        ? {
            ...fallback.exitPlan,
            rule:
              value.exitPlan.rule === "time_stop" ||
              value.exitPlan.rule === "coverage_arrival" ||
              value.exitPlan.rule === "price_target" ||
              value.exitPlan.rule === "manual"
                ? value.exitPlan.rule
                : fallback.exitPlan.rule,
            horizonHours: readNumber(value.exitPlan, "horizonHours") ?? fallback.exitPlan.horizonHours,
            entryWindowHours:
              readNumber(value.exitPlan, "entryWindowHours") ?? fallback.exitPlan.entryWindowHours,
            targetPrice: readNumber(value.exitPlan, "targetPrice") ?? fallback.exitPlan.targetPrice,
            notes: readString(value.exitPlan, "notes") ?? fallback.exitPlan.notes,
          }
        : fallback.exitPlan,
  };
}

function normalizeReceipt(value: unknown, fallback: ExecutionReceipt): ExecutionReceipt {
  if (!isRecord(value)) return fallback;

  return {
    ...fallback,
    venue:
      value.venue === "ibkr" || value.venue === "polymarket" ? value.venue : fallback.venue,
    mode: value.mode === "paper" || value.mode === "live" ? value.mode : fallback.mode,
    status:
      value.status === "preview" ||
      value.status === "submitted" ||
      value.status === "filled" ||
      value.status === "skipped" ||
      value.status === "rejected" ||
      value.status === "error"
        ? value.status
        : fallback.status,
    symbolOrToken: readString(value, "symbolOrToken") ?? fallback.symbolOrToken,
    side: value.side === "buy" || value.side === "sell" ? value.side : fallback.side,
    notionalUsd: readNumber(value, "notionalUsd") ?? fallback.notionalUsd,
    receiptId: readString(value, "receiptId") ?? fallback.receiptId,
    submittedAt: readString(value, "submittedAt") ?? fallback.submittedAt,
    filledPrice: readNumber(value, "filledPrice") ?? fallback.filledPrice,
    filledQuantity: readNumber(value, "filledQuantity") ?? fallback.filledQuantity,
    orderId: readString(value, "orderId") ?? fallback.orderId,
    artifactRef: readString(value, "artifactRef") ?? fallback.artifactRef,
    message: readString(value, "message") ?? fallback.message,
    raw: isRecord(value.raw) ? value.raw : fallback.raw,
  };
}

function normalizePosition(value: unknown, fallback: Position): Position {
  if (!isRecord(value)) return fallback;

  return {
    ...fallback,
    id: readString(value, "id") ?? fallback.id,
    strategyId: readString(value, "strategyId") ?? fallback.strategyId,
    strategyName: readString(value, "strategyName") ?? fallback.strategyName,
    venue:
      value.venue === "ibkr" || value.venue === "polymarket" ? value.venue : fallback.venue,
    mode: value.mode === "paper" || value.mode === "live" ? value.mode : fallback.mode,
    symbolOrToken: readString(value, "symbolOrToken") ?? fallback.symbolOrToken,
    direction:
      value.direction === "long" ||
      value.direction === "short" ||
      value.direction === "yes" ||
      value.direction === "no" ||
      value.direction === "none"
        ? value.direction
        : fallback.direction,
    quantity: readNumber(value, "quantity") ?? fallback.quantity,
    entryPrice: readNumber(value, "entryPrice") ?? fallback.entryPrice,
    markPrice: readNumber(value, "markPrice") ?? fallback.markPrice,
    exposureUsd: readNumber(value, "exposureUsd") ?? fallback.exposureUsd,
    realizedPnlUsd: readNumber(value, "realizedPnlUsd") ?? fallback.realizedPnlUsd,
    status: value.status === "open" || value.status === "closed" ? value.status : fallback.status,
    updatedAt: readString(value, "updatedAt") ?? fallback.updatedAt,
  };
}

function looksLikeRawSignal(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Boolean(readStringCandidate(value, ["title", "headline", "name"])) &&
    Boolean(readStringCandidate(value, ["sourceUrl", "source_url", "url", "link"]))
  );
}

function looksLikeReviewedSignal(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Boolean(readStringCandidate(value, ["fingerprint", "reviewFingerprint", "signalFingerprint"])) &&
    (
      typeof value.tradable === "boolean" ||
      Array.isArray(value.instrumentCandidates) ||
      Array.isArray(value.instrument_candidates) ||
      Boolean(readStringCandidate(value, ["thesis", "reasoning", "summary"]))
    )
  );
}

function dedupeBy<T>(items: T[], keyFor: (item: T, index: number) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item, index) => {
    const key = keyFor(item, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readObjectCandidate(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (isRecord(candidate)) return candidate;
  }

  return value;
}

function readArrayCandidate(value: unknown, keys: string[]): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return undefined;

  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }

  return undefined;
}

function resolveTinyfishSkill(
  recipe: RecipeDefinition,
  request: RunRequest,
): "scan" | "hunt" {
  if (request.skills?.length === 1) {
    return request.skills[0];
  }

  return recipe.category === "prediction" ? "hunt" : "scan";
}

function buildTinyfishSources(
  selectedSources: RecipeDefinition["sources"],
): Array<Record<string, string>> {
  return selectedSources.map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    country: source.country,
    lang: source.locale,
  }));
}

function buildPredictionWatchlist(
  recipe: RecipeDefinition,
  request: RunRequest,
  selectedSources: RecipeDefinition["sources"],
): Array<Record<string, string>> {
  if (selectedSources.length === 0) {
    return [
      {
        id: recipe.id,
        title: recipe.title,
        polymarketQuery: request.strategyBrief || recipe.title,
        resolutionSourceUrl: recipe.sources[0]?.url ?? "https://polymarket.com/",
      },
    ];
  }

  return selectedSources.map((source) => ({
    id: source.id,
    title: source.name,
    polymarketQuery:
      source.id === "cme-fedwatch"
        ? "Fed rate no change next meeting"
        : source.id === "sec-edgar"
          ? "SEC filing approval denial markets"
          : request.strategyBrief || `${recipe.title} ${source.name}`,
    resolutionSourceUrl: source.url,
  }));
}

function buildTinyfishRequestBody(
  runId: string,
  recipe: RecipeDefinition,
  request: RunRequest,
  selectedSources: RecipeDefinition["sources"],
): Record<string, unknown> {
  const skill = resolveTinyfishSkill(recipe, request);
  const selectedCountries = request.countries ?? recipe.countries;

  return {
    skill,
    payload: {
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      promptVersion: request.promptVersion ?? recipe.promptVersion,
      strategyBrief: request.strategyBrief,
      countries: selectedCountries,
      sources: buildTinyfishSources(selectedSources),
      preferredVenue: request.preferredVenue ?? recipe.defaultVenueBias,
    },
    config:
      skill === "hunt"
        ? {
            watchlist: buildPredictionWatchlist(recipe, request, selectedSources),
          }
        : selectedSources.length > 0
          ? {
              sources: buildTinyfishSources(selectedSources),
            }
          : {
              countries: selectedCountries,
            },
  };
}

function buildReviewConstraints(
  recipe: RecipeDefinition,
  request: RunRequest,
): Record<string, string | number | boolean | string[]> {
  return {
    accountType: request.mode === "live" ? "margin" : "cash",
    balanceUsd: request.mode === "live" ? 100_000 : 25_000,
    maxPositionUsd: request.mode === "live" ? 2_500 : 1_000,
    previewOnly: request.previewOnly,
    preferredVenue: request.preferredVenue ?? recipe.defaultVenueBias,
    countries: request.countries ?? recipe.countries,
  };
}

function extractStreamingUrl(records: unknown[]): string | undefined {
  for (const record of records) {
    if (!isRecord(record)) continue;

    const direct = readStringCandidate(record, ["streamingUrl", "streaming_url"]);
    if (direct) return direct;

    const nested = readObjectCandidate(record, ["result", "data"]);
    const nestedUrl =
      nested && readStringCandidate(nested, ["streamingUrl", "streaming_url"]);
    if (nestedUrl) return nestedUrl;
  }

  return undefined;
}

function extractRuntimeRawSignals(
  records: unknown[],
  fallbacks: RawSignal[],
): RawSignal[] {
  const collected: RawSignal[] = [];

  for (const record of records) {
    const candidates = readArrayCandidate(record, ["rawSignals", "signals", "results", "data"]);
    if (candidates && candidates.length > 0) {
      collected.push(
        ...candidates.map((signal, index) =>
          normalizeRawSignal(signal, fallbacks[index] ?? fallbacks[0]),
        ),
      );
      continue;
    }

    if (looksLikeRawSignal(record)) {
      collected.push(normalizeRawSignal(record, fallbacks[collected.length] ?? fallbacks[0]));
    }
  }

  return dedupeBy(
    collected,
    (signal, index) => signal.fingerprint || signal.id || `${signal.sourceUrl}:${index}`,
  );
}

function extractRuntimeReviewedSignals(
  records: unknown[],
  rawSignals: RawSignal[],
  fallbacks: ReviewedSignal[],
): ReviewedSignal[] {
  const candidates: ReviewedSignal[] = [];

  for (const record of records) {
    const arrayPayload = readArrayCandidate(record, [
      "reviewedSignals",
      "reviews",
      "results",
      "data",
    ]);
    if (arrayPayload && arrayPayload.length > 0) {
      candidates.push(
        ...arrayPayload.map((entry, index) =>
          normalizeReviewedSignal(entry, fallbacks[index] ?? fallbacks[0]),
        ),
      );
      continue;
    }

    if (looksLikeReviewedSignal(record)) {
      candidates.push(
        normalizeReviewedSignal(record, fallbacks[candidates.length] ?? fallbacks[0]),
      );
    }
  }

  const uniqueCandidates = dedupeBy(
    candidates,
    (reviewedSignal, index) => reviewedSignal.fingerprint || `${reviewedSignal.title}:${index}`,
  );
  const byFingerprint = new Map(
    uniqueCandidates.map((reviewedSignal) => [reviewedSignal.fingerprint, reviewedSignal]),
  );

  return rawSignals.map((rawSignal, index) => {
    return byFingerprint.get(rawSignal.fingerprint) ?? fallbacks[index];
  });
}

async function collectRawSignals(
  runId: string,
  recipe: RecipeDefinition,
  request: RunRequest,
  selectedSources: RecipeDefinition["sources"],
  fallbacks: RawSignal[],
): Promise<{ rawSignals: RawSignal[]; streamingUrl: string; provider: string }> {
  const config = getRuntimeConfig();
  const fallbackStreamingUrl = `https://stream.agent.tinyfish.ai/demo/${runId}`;

  if (!config.tinyfishRunUrl) {
    return {
      rawSignals: fallbacks,
      streamingUrl: fallbackStreamingUrl,
      provider: "demo",
    };
  }

  try {
    const response = await postRuntimeRecords<Record<string, unknown>>(
      config.tinyfishRunUrl,
      buildTinyfishRequestBody(runId, recipe, request, selectedSources),
      {
        apiKey: config.tinyfishApiKey,
        apiKeyHeader: "X-API-Key",
        sharedSecret: config.tradingGatewaySharedSecret,
        accept: "text/event-stream, application/json",
        timeoutMs: 7_500,
      },
    );
    const rawSignals = extractRuntimeRawSignals(response, fallbacks);

    return {
      rawSignals,
      streamingUrl: extractStreamingUrl(response) ?? fallbackStreamingUrl,
      provider: "tinyfish",
    };
  } catch {
    return {
      rawSignals: fallbacks,
      streamingUrl: fallbackStreamingUrl,
      provider: "demo",
    };
  }
}

async function reviewSignals(
  runId: string,
  recipe: RecipeDefinition,
  request: RunRequest,
  rawSignals: RawSignal[],
  fallbacks: ReviewedSignal[],
): Promise<{ reviewedSignals: ReviewedSignal[]; provider: string }> {
  const config = getRuntimeConfig();

  if (!config.reviewUrl || rawSignals.length === 0) {
    return {
      reviewedSignals: fallbacks,
      provider: "demo",
    };
  }

  try {
    const response = await postRuntimeRecords<Record<string, unknown>>(
      config.reviewUrl,
      {
        runId,
        recipeId: recipe.id,
        strategyId: request.strategyId,
        promptVersion: request.promptVersion ?? recipe.promptVersion,
        signals: rawSignals,
        constraints: buildReviewConstraints(recipe, request),
      },
      {
        bearerToken: config.openAiApiKey,
        sharedSecret: config.tradingGatewaySharedSecret,
        accept: "text/event-stream, application/json",
        timeoutMs: 8_000,
      },
    );
    const reviewedSignals = extractRuntimeReviewedSignals(response, rawSignals, fallbacks);

    return {
      reviewedSignals,
      provider: "review",
    };
  } catch {
    return {
      reviewedSignals: fallbacks,
      provider: "demo",
    };
  }
}

async function executeIntent(
  runId: string,
  recipe: RecipeDefinition,
  request: RunRequest,
  intent: ExecutionIntent,
  fallbackReceipt: ExecutionReceipt,
  fallbackPosition: Position,
): Promise<{ receipt: ExecutionReceipt; position: Position; provider: string }> {
  if (request.previewOnly) {
    return {
      receipt: fallbackReceipt,
      position: fallbackPosition,
      provider: "demo",
    };
  }

  const config = getRuntimeConfig();
  const gatewayUrl = intent.venue === "ibkr" ? config.ibkrGatewayUrl : config.polymarketGatewayUrl;
  const bearerToken =
    intent.venue === "ibkr" ? config.ibkrApiToken : config.polyApiKey;

  if (!gatewayUrl) {
    return {
      receipt: fallbackReceipt,
      position: fallbackPosition,
      provider: "demo",
    };
  }

  try {
    const response = await postRuntimeJson<Record<string, unknown>>(
      gatewayUrl,
      {
        runId,
        recipeId: recipe.id,
        request,
        intent,
      },
      {
        bearerToken,
        sharedSecret: config.tradingGatewaySharedSecret,
        headers:
          intent.venue === "ibkr" && config.ibkrAccountId
            ? { "x-ibkr-account-id": config.ibkrAccountId }
            : undefined,
      },
    );
    const receiptPayload = readObjectCandidate(response, ["receipt", "executionReceipt"]);
    const positionPayload = readObjectCandidate(response, ["position"]);
    const receipt = normalizeReceipt(receiptPayload, fallbackReceipt);
    const position = normalizePosition(positionPayload, fallbackPosition);

    return {
      receipt,
      position,
      provider: intent.venue,
    };
  } catch {
    return {
      receipt: fallbackReceipt,
      position: fallbackPosition,
      provider: "demo",
    };
  }
}

export async function buildRuntimeRunTimeline(runId: string, requestInput: RunRequest): Promise<TimedEvent[]> {
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

  const fallbackRawSignals = buildRawSignals(runId, recipe, request);
  const collection = await collectRawSignals(
    runId,
    recipe,
    request,
    selectedSources,
    fallbackRawSignals,
  );
  const rawSignals = collection.rawSignals;

  if (rawSignals.length === 0) {
    return buildBlockedTimeline(
      runId,
      recipe,
      request,
      "Source fanout completed, but no new tradable signals were produced.",
    );
  }

  const fallbackReviewedSignals = rawSignals.map((rawSignal) =>
    buildReviewedSignal(rawSignal, recipe, request),
  );
  const review = await reviewSignals(
    runId,
    recipe,
    request,
    rawSignals,
    fallbackReviewedSignals,
  );
  const reviewedSignals = review.reviewedSignals;
  const firstReviewed = reviewedSignals[0];
  const activeInstruments = firstReviewed.instrumentCandidates.slice(
    0,
    recipe.category === "prediction" ? 1 : 2,
  );
  const intents = activeInstruments.map((instrument) => buildIntent(firstReviewed, instrument, request));

  const executionResults = await Promise.all(
    (request.execute ? intents : []).map(async (intent) => {
      const fallbackReceipt = buildReceipt(intent, request);
      const fallbackPosition = buildPosition(
        intent,
        fallbackReceipt,
        request.strategyId,
        request.strategyBrief || recipe.title,
      );

      return executeIntent(runId, recipe, request, intent, fallbackReceipt, fallbackPosition);
    }),
  );

  const receipts = executionResults.map((result) => result.receipt);
  const positions = executionResults.map((result) => result.position);
  const reviewProvider = review.provider;
  const executionProvider =
    executionResults.find((result) => result.provider === "ibkr" || result.provider === "polymarket")?.provider ??
    "demo";

  const timeline: TimedEvent[] = [
    {
      id: makeEventId("evt"),
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
        collector_provider: collection.provider,
        review_provider: reviewProvider,
        execution_provider: executionProvider,
      },
      delayMs: 220,
    },
    {
      id: makeEventId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "STREAMING_URL",
      timestamp: iso(1),
      message:
        collection.provider === "tinyfish"
          ? "TinyFish collector returned a runtime-backed stream for replay."
          : "TinyFish streaming URL captured for replay.",
      progress: 12,
      meta: {
        streaming_url: collection.streamingUrl,
        countries: request.countries?.join(", ") ?? recipe.countries.join(", "),
        source_count: selectedSources.length,
        collector_provider: collection.provider,
      },
      delayMs: 320,
    },
  ];

  selectedSources.forEach((source, index) => {
    const progress = 18 + Math.round(((index + 1) / selectedSources.length) * 22);
    timeline.push({
      id: makeEventId("evt"),
      runId,
      recipeId: recipe.id,
      strategyId: request.strategyId,
      phase: "SOURCE_PROGRESS",
      timestamp: iso(index + 2),
      message:
        collection.provider === "tinyfish"
          ? `TinyFish collector is scanning ${source.name} with runtime routing enabled.`
          : `Scanning ${source.name} with ${source.status === "fragile" ? "fallback-aware" : "primary"} prompt flow.`,
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
      id: makeEventId("evt"),
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
      id: makeEventId("evt"),
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
      id: makeEventId("evt"),
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
      id: makeEventId("evt"),
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
    id: makeEventId("evt"),
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
      collector_provider: collection.provider,
      review_provider: reviewProvider,
      execution_provider: executionProvider,
    },
    delayMs: 260,
  });

  return timeline;
}
