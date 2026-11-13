export type Trigger = "schedule" | "opening" | "first-trade";
export type PurchaseState = "draft" | "armed" | "waiting-for-listing" | "waiting-for-opening" | "blocked" | "submitted" | "partially-filled" | "filled" | "cancellation-pending" | "cancelled" | "expired" | "revoked" | "reconciliation-required";
export interface Instrument {
  id: string; issuer: string; symbol: string | null; conid: number | null;
  exchange: string; currency: string; shareClass: string; timezone: string;
  evidence: "fixture" | "broker-verified"; listing: "verified" | "unconfirmed" | "ambiguous";
  supportedTriggers: Trigger[]; reasons: string[];
}
export interface MandateInput {
  instrumentId: string; accountId: string; trigger: Trigger; scheduledAt: string;
  timezone: string; session: "regular"; shares: number; limitPrice: number;
  maxSpend: number; buffer: number; expiresAt: string;
}
export interface Receipt {
  at: string; kind: string; message: string; evidence: "mock" | "broker";
}
export interface Execution {
  id: string; quantity: number; price: number; fee: number | null; currency: string;
}
export interface Purchase extends MandateInput {
  id: string; createdAt: string; state: PurchaseState; reasons: string[];
  /** Legacy absence means initial revision zero, not renewed authority. */
  revision?: number;
  cancellationPolicy: "cancel-remainder-at-expiry-or-session-end";
  intentId?: string; brokerOrderId?: string; filledShares: number; spent: number;
  reserved: number; receipts: Receipt[]; revoked?: boolean;
  executions: Execution[];
  instrumentSnapshot: Instrument;
  accountMode: AccountStatus["mode"];
  contract?: Pick<Instrument, "conid" | "exchange" | "currency" | "evidence">;
  /** Only prepared proves no submission was attempted. Legacy absence is unknown. */
  submitPhase?: "prepared" | "attempted";
  stopRequested?: "revoked" | "cancelled" | "expired";
}
export interface AccountStatus {
  id: string; mode: "mock" | "paper" | "live"; currency: string; availableCash: number; cashBalances: Record<string, number>;
  authenticated: boolean; sessionReady: boolean; permissions: string[];
  dataEntitled: boolean; reasons: string[];
}
export interface Preview { supported: boolean; reasons: string[]; estimatedMaximum: number; instrument: Instrument | null }
export interface PurchaseDashboard {
  mode: AccountStatus["mode"] | "disabled"; mutationEnabled: boolean; evidence: "mock" | "broker";
  catalog: Instrument[]; account: AccountStatus; purchases: Purchase[];
  killSwitch: boolean; capabilities: { trigger: Trigger; supported: boolean; reasons: string[] }[];
  notices: string[];
  scheduler: { lastCheckAt: string | null; checkedRecently: boolean };
}
