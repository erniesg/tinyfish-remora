export type Venue = "ibkr" | "polymarket";
export type ExecutionMode = "paper" | "live";
export type StrategySource = "recipe" | "agent-generated";
export type ConnectionStatus = "ready" | "warning" | "missing";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type SignalKind = "policy" | "prediction";
export type VenueCandidate = Venue | "both" | "none";
export type Direction = "long" | "short" | "yes" | "no" | "none";
export type RecipeReadiness = "demo" | "research" | "live-ready";
export type ApprovalState = "paper" | "live-candidate" | "live-armed";
export type SourceKind = "official" | "archive" | "market" | "watchlist";
export type AgentEventPhase =
  | "STARTED"
  | "STREAMING_URL"
  | "SOURCE_PROGRESS"
  | "RAW_SIGNAL"
  | "REVIEWED_SIGNAL"
  | "DECISION"
  | "RECEIPT"
  | "BLOCKED"
  | "COMPLETE";

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  company?: string;
  riskProfile: RiskProfile;
}

export interface RecipeSource {
  id: string;
  name: string;
  url: string;
  country: string;
  locale: string;
  kind: SourceKind;
  status: "healthy" | "fragile";
  cadence: string;
}

export interface RecipeDefinition {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: "government" | "prediction";
  countries: string[];
  sources: RecipeSource[];
  supportedVenues: Venue[];
  readiness: RecipeReadiness;
  evidenceCount: number;
  sampleSignalCount: number;
  lastSuccessfulRunAt: string;
  promptVersion: string;
  scoringModel: string;
  strategyOutline: string;
  antiBotPolicy: string[];
  fallbackPolicy: string[];
  guardrails: string[];
  knownFailureModes: string[];
  suggestedSkills: Array<"scan" | "hunt">;
  defaultVenueBias: VenueCandidate;
}

export interface RunRequest {
  recipeId?: string;
  strategyId?: string;
  countries?: string[];
  sources?: string[];
  strategyBrief?: string;
  skills?: Array<"scan" | "hunt">;
  mode: ExecutionMode;
  execute: boolean;
  previewOnly: boolean;
  force: boolean;
  promptVersion?: string;
  preferredVenue?: VenueCandidate;
}

export interface RunLaunchResponse {
  runId: string;
  label: string;
  request: RunRequest;
  streamUrl: string;
  streamingUrl: string;
}

export interface TradableHints {
  venueHint?: VenueCandidate;
  ticker?: string;
  marketSlug?: string;
  sentiment?: "bullish" | "bearish" | "neutral";
  resolutionSourceUrl?: string;
  country?: string;
}

export interface RawSignal {
  id: string;
  runId: string;
  recipeId: string;
  kind: SignalKind;
  source: string;
  sourceId: string;
  sourceUrl: string;
  publishedAt: string;
  title: string;
  summary: string;
  fingerprint: string;
  country: string;
  language: string;
  tradableHints?: TradableHints;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewedInstrument {
  venue: Venue;
  symbolOrToken: string;
  label: string;
  marketSlug?: string;
  sideHint?: "buy" | "sell";
  proxyFor?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ExitPlan {
  rule: "time_stop" | "coverage_arrival" | "price_target" | "manual";
  horizonHours: number;
  entryWindowHours: number;
  targetPrice?: number;
  notes?: string;
}

export interface ReviewedSignal {
  fingerprint: string;
  tradable: boolean;
  venueCandidates: VenueCandidate;
  instrumentCandidates: ReviewedInstrument[];
  direction: Direction;
  confidence: number;
  reviewScore: number;
  horizonHours: number | null;
  entryWindowHours: number | null;
  exitPlan: ExitPlan | null;
  thesis: string;
  constraintsApplied: string[];
  reasoning?: string;
  source: string;
  title: string;
}

export interface ExecutionIntent {
  reviewFingerprint: string;
  venue: Venue;
  mode: ExecutionMode;
  symbolOrToken: string;
  side: "buy" | "sell";
  notionalUsd: number;
  maxSlippageBps: number;
  expiresAt: string;
  exitPlan: ExitPlan;
  thesis: string;
  label: string;
  marketSlug?: string;
  previewOnly?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ExecutionReceipt {
  venue: Venue;
  mode: ExecutionMode;
  status: "preview" | "submitted" | "filled" | "skipped" | "rejected" | "error";
  symbolOrToken: string;
  side: "buy" | "sell";
  notionalUsd: number;
  receiptId: string;
  submittedAt: string;
  filledPrice?: number;
  filledQuantity?: number;
  orderId?: string;
  artifactRef?: string;
  message?: string;
  raw?: Record<string, unknown>;
}

export interface Position {
  id: string;
  strategyId: string;
  strategyName: string;
  venue: Venue;
  mode: ExecutionMode;
  symbolOrToken: string;
  direction: Direction;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  exposureUsd: number;
  realizedPnlUsd: number;
  status: "open" | "closed";
  updatedAt: string;
}

export interface StrategyDraft {
  id: string;
  name: string;
  objective: string;
  thesis: string;
  riskProfile: RiskProfile;
  promptVersion: string;
  source: StrategySource;
  runConfig: RunRequest;
  venueMapping: Array<{
    venue: Venue;
    instruments: string[];
    rationale: string;
  }>;
  scoringRationale: string[];
  scorecard: Array<{
    label: string;
    score: number;
    note: string;
  }>;
  approvalState: ApprovalState;
  createdAt: string;
}

export interface StrategyVersion extends StrategyDraft {
  version: number;
  guardrails: string[];
  readiness: RecipeReadiness;
  lastRunSummary?: string;
}

export interface VenueConnection {
  id: string;
  venue: Venue;
  mode: ExecutionMode;
  label: string;
  description: string;
  fields: Record<string, string>;
  status: ConnectionStatus;
  statusNote: string;
}

export interface RunSummary {
  id: string;
  label: string;
  request: RunRequest;
  recipeId?: string;
  strategyId?: string;
  mode: ExecutionMode;
  status: "running" | "complete" | "blocked";
  progress: number;
  phase: AgentEventPhase;
  startedAt: string;
  completedAt?: string;
  lastMessage: string;
  streamingUrl: string;
  rawSignals: RawSignal[];
  reviewedSignals: ReviewedSignal[];
  intents: ExecutionIntent[];
  receipts: ExecutionReceipt[];
  fallbackState?: "blocked" | "empty";
}

export interface AgentEvent {
  id: string;
  runId: string;
  recipeId?: string;
  strategyId?: string;
  phase: AgentEventPhase;
  timestamp: string;
  message: string;
  progress: number;
  meta?: Record<string, string | number | boolean | null>;
  rawSignal?: RawSignal;
  reviewedSignal?: ReviewedSignal;
  intent?: ExecutionIntent;
  receipt?: ExecutionReceipt;
  position?: Position;
}

export interface GeneratedStrategyResponse {
  draft: StrategyDraft;
  reasoning: string[];
}
