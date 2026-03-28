export type Venue = "ibkr" | "polymarket";
export type ExecutionMode = "paper" | "live";
export type StrategySource = "recipe" | "agent-generated";
export type ConnectionStatus = "ready" | "warning" | "missing";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type Direction = "long" | "short" | "yes" | "no";
export type AgentEventPhase =
  | "STARTED"
  | "STREAMING_URL"
  | "PROGRESS"
  | "SIGNAL"
  | "REVIEW"
  | "DECISION"
  | "RECEIPT"
  | "COMPLETE";

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  company?: string;
  riskProfile: RiskProfile;
}

export interface RecipePreset {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  sourceLocale: string;
  defaultGoal: string;
  antiBotPolicy: string[];
  fallbackPolicy: string[];
  keywords: string[];
  primaryVenue: Venue;
  venues: Venue[];
  thesis: string;
  parallelPlan: string;
  riskNote: string;
}

export interface StrategyVersion {
  id: string;
  version: number;
  name: string;
  source: StrategySource;
  objective: string;
  thesis: string;
  recipeIds: string[];
  keywords: string[];
  universe: string[];
  venues: Venue[];
  riskProfile: RiskProfile;
  scoringModel: string;
  entryRules: string[];
  exitRules: string[];
  risk: {
    perTradeMaxUsd: number;
    dailyLossLimitUsd: number;
    maxOpenPositions: number;
    slippageBpsLimit: number;
  };
  execution: {
    mode: ExecutionMode;
    autoEntry: boolean;
    autoExit: boolean;
  };
  rationale: string[];
  createdAt: string;
  lastRunLabel?: string;
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

export interface SignalRecord {
  id: string;
  recipeId: string;
  title: string;
  source: string;
  sourceUrl: string;
  language: string;
  publishedAt: string;
  venue: Venue;
  instrument: string;
  direction: Direction;
  confidence: number;
  score: number;
  keywords: string[];
  reasoning: string;
}

export interface ExecutionIntent {
  id: string;
  strategyId: string;
  venue: Venue;
  mode: ExecutionMode;
  instrument: string;
  side: "buy" | "sell";
  notionalUsd: number;
  maxSlippageBps: number;
  thesis: string;
  label: string;
}

export interface ExecutionReceipt {
  id: string;
  runId: string;
  status: "preview" | "submitted" | "filled";
  venue: Venue;
  mode: ExecutionMode;
  instrument: string;
  side: "buy" | "sell";
  notionalUsd: number;
  fillPrice: number;
  quantity: number;
  message: string;
}

export interface Position {
  id: string;
  strategyId: string;
  strategyName: string;
  venue: Venue;
  mode: ExecutionMode;
  instrument: string;
  direction: Direction;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  exposureUsd: number;
  realizedPnlUsd: number;
  status: "open" | "closed";
  updatedAt: string;
}

export interface RunDescriptor {
  batchId: string;
  runId: string;
  recipeId: string;
  strategyId: string;
  title: string;
  mode: ExecutionMode;
  venue: Venue;
  streamUrl: string;
  streamingUrl: string;
}

export interface RunBatchResponse {
  batchId: string;
  createdAt: string;
  mode: ExecutionMode;
  runs: RunDescriptor[];
}

export interface RunSummary {
  id: string;
  title: string;
  mode: ExecutionMode;
  venue: Venue;
  status: "running" | "complete";
  completedAt?: string;
  lastMessage: string;
}

export interface AgentEvent {
  id: string;
  runId: string;
  recipeId: string;
  phase: AgentEventPhase;
  timestamp: string;
  message: string;
  progress: number;
  meta?: Record<string, string | number | boolean | null>;
  signal?: SignalRecord;
  intent?: ExecutionIntent;
  receipt?: ExecutionReceipt;
  position?: Position;
}

export interface GeneratedStrategyResponse {
  strategy: StrategyVersion;
  scorecard: Array<{
    label: string;
    score: number;
    note: string;
  }>;
  reasoning: string[];
}
