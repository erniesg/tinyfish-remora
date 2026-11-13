import type { AccountStatus, Execution, Instrument, Purchase } from "./types";
import type { Transaction } from "./store";
import { fixtureMarket, localTime } from "./catalog";
import { cpRow, identity, mapOrder, orderId, related } from "./client-portal-orders";

export interface BrokerOrder {
  intentId: string; orderId: string; state: "submitted" | "partially-filled" | "filled" | "cancelled" | "rejected" | "unknown";
  filledShares: number; spent: number; feesKnown: boolean; executions: Execution[];
}
export class OrderNotSent extends Error {}
/** Rechecked synchronously immediately before the order transport is invoked. */
export function evidenceTimeReasons(p: Purchase, f: Preflight | undefined, now: Date): string[] {
  const t = now.getTime();
  const reasons: string[] = [];
  if (!Number.isFinite(t) || t >= Date.parse(p.expiresAt)) reasons.push("Mandate expired; order NOT SENT.");
  if (!f || !(Date.parse(f.validUntil ?? "") > t)) reasons.push("Preflight trust evidence expired or validity horizon unknown.");
  if (!f || !(Date.parse(f.sessionOpensAt ?? "") <= t && t < Date.parse(f.sessionClosesAt ?? ""))) reasons.push("Approved regular session is not currently open; explicit session bounds required.");
  if (f?.sessionOpensAt && Number.isFinite(Date.parse(f.sessionOpensAt)) &&
    localTime(new Date(f.sessionOpensAt), p.instrumentSnapshot.timezone).date !== localTime(new Date(p.scheduledAt), p.instrumentSnapshot.timezone).date) reasons.push("Session evidence does not match the approved exchange date; no rollover.");
  const age = t - Date.parse(f?.quoteAt ?? "");
  if (!Number.isFinite(age) || age < -1000 || age > 30000) reasons.push("Quote is missing, stale or invalid.");
  return reasons;
}
export interface Preflight {
  accountId: string; accountMode: "mock" | "paper" | "live"; currency: string; availableCash: number; cashSettled: boolean; authenticated: boolean;
  sessionReady: boolean; permitted: boolean; dataEntitled: boolean;
  quote: number | null; quoteAt: string | null; quoteCurrency: string; calendarKnown: boolean;
  open: boolean; firstTrade: boolean; halted: boolean; closedForDay: boolean;
  /** Exclusive trust horizon and exact regular-session interval, never a cached open boolean. */
  validUntil?: string; sessionOpensAt?: string; sessionClosesAt?: string;
  /** Explicit trusted execution constraints; absent means unknown, not permission. */
  venueOrderSupported?: boolean; quantitySupported?: boolean; priceUnitVerified?: boolean; feeBound?: number | null;
  reasons: string[];
}
export interface Broker {
  evidence: "mock" | "broker";
  preflight(purchase: Purchase, instrument: Instrument, now: Date): Promise<Preflight>;
  submit(purchase: Purchase, instrument: Instrument, evidence?: Preflight): Promise<BrokerOrder>;
  reconcile(purchase: Purchase): Promise<BrokerOrder | null>;
  cancel(purchase: Purchase): Promise<BrokerOrder | null>;
}
export const mockAccount: AccountStatus = { id: "mock-cash", mode: "mock", currency: "USD", availableCash: 100000, cashBalances: { USD: 100000, SGD: 50000, GBP: 25000 }, authenticated: true, sessionReady: true, permissions: ["NASDAQ:STK", "SGX:STK", "LSE:STK"], dataEntitled: true, reasons: ["Separate simulated USD, SGD and GBP cash balances. No borrowing or automatic FX conversion."] };
export interface MockScenario {
  preflight?: Partial<Preflight>; outcome?: "fill" | "partial" | "unknown" | "reject";
}
export class MockBroker implements Broker {
  evidence = "mock" as const;
  constructor(private tx: Transaction, private scenario: MockScenario = {}) {}
  async preflight(p: Purchase, instrument: Instrument, now: Date): Promise<Preflight> {
    const market = fixtureMarket(instrument, now);
    const localMinute = new Intl.DateTimeFormat("en", { timeZone: instrument.timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const minute = Number(localMinute.find(p => p.type === "hour")!.value) * 60 + Number(localMinute.find(p => p.type === "minute")!.value);
    const start = instrument.exchange === "SGX" ? (minute >= 780 ? 780 : 540) : instrument.exchange === "LSE" ? 480 : 570;
    const end = instrument.exchange === "SGX" ? (minute < 720 ? 720 : 1020) : instrument.exchange === "LSE" ? 990 : 960;
    const midnight = now.getTime() - minute * 60000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
    return { validUntil: new Date(now.getTime() + 30000).toISOString(), sessionOpensAt: new Date(midnight + start * 60000).toISOString(), sessionClosesAt: new Date(midnight + end * 60000).toISOString(), accountId: mockAccount.id, accountMode: "mock", currency: instrument.currency, availableCash: mockAccount.cashBalances[instrument.currency] ?? 0, cashSettled: true, authenticated: true, sessionReady: true, permitted: mockAccount.permissions.includes(`${instrument.exchange}:STK`), dataEntitled: true, quote: 100, quoteAt: now.toISOString(), quoteCurrency: instrument.currency, calendarKnown: true, open: market.open, firstTrade: market.firstTrade, halted: market.halted, closedForDay: market.closedForDay, venueOrderSupported: true, quantitySupported: true, priceUnitVerified: true, feeBound: 5, reasons: [], ...this.scenario.preflight };
  }
  async submit(p: Purchase): Promise<BrokerOrder> {
    if (!p.intentId) throw new Error("Durable intent required.");
    const existing = this.tx.data.mockOrders[p.intentId];
    if (existing) return existing;
    const partial = this.scenario.outcome === "partial";
    const rejected = this.scenario.outcome === "reject";
    const quantity = rejected ? 0 : partial ? Math.max(0, Math.floor(p.shares / 2)) : p.shares;
    const executions: Execution[] = quantity ? [{ id: `mock-fill-${p.intentId}-1`, quantity, price: Math.min(100, p.limitPrice), fee: 0, currency: p.instrumentSnapshot.currency }] : [];
    const order: BrokerOrder = { intentId: p.intentId, orderId: `mock-${p.intentId}`, state: rejected ? "rejected" : partial ? "partially-filled" : "filled", filledShares: quantity, spent: quantity * Math.min(100, p.limitPrice), feesKnown: true, executions };
    this.tx.data.mockOrders[p.intentId] = order;
    await this.tx.save(); // Broker acceptance survives a lost response.
    if (this.scenario.outcome === "unknown") throw new Error("Simulated lost submit response.");
    return order;
  }
  async reconcile(p: Purchase) { return p.intentId ? this.tx.data.mockOrders[p.intentId] ?? null : null; }
  async cancel(p: Purchase) {
    const order = await this.reconcile(p);
    if (!order) return null;
    if (order.state !== "filled" && order.state !== "rejected") order.state = "cancelled";
    await this.tx.save();
    return order;
  }
}

/** Inject a server-only transport. No default fetch, credentials, login, or routing from the public API. */
export type ClientPortalTransport = (method: "GET" | "POST" | "DELETE", path: string, body?: unknown) => Promise<unknown>;
export interface ClientPortalEvidence {
  // Must be supplied by verified account/entity/permissions/data/calendar integrations.
  preflight(p: Purchase, instrument: Instrument, now: Date): Promise<Preflight>;
  executionAllowed(mode: "paper" | "live", accountId: string): boolean;
}
export class ClientPortalBroker implements Broker {
  evidence = "broker" as const;
  constructor(private transport: ClientPortalTransport, private accountId: string, private mode: "paper" | "live", private verified: ClientPortalEvidence, private clock: () => Date = () => new Date()) {}
  async preflight(p: Purchase, i: Instrument, now: Date) {
    const result = await this.verified.preflight(p, i, now);
    const auth = await this.transport("GET", "/iserver/auth/status") as { authenticated?: boolean; connected?: boolean; competing?: boolean };
    const accounts = await this.transport("GET", "/iserver/accounts") as { accounts?: string[] };
    return { ...result, authenticated: result.authenticated && auth.authenticated === true, sessionReady: result.sessionReady && result.accountMode === this.mode && auth.connected === true && auth.competing !== true && accounts.accounts?.includes(this.accountId) === true, reasons: [...result.reasons, ...(!this.verified.executionAllowed(this.mode, this.accountId) ? ["Broker execution authority is held."] : [])] };
  }
  private guard(p: Purchase) {
    if (p.accountId !== this.accountId || p.accountMode !== this.mode || !this.verified.executionAllowed(this.mode, this.accountId)) throw new Error("Client Portal execution held: exact account and explicit execution authority required.");
  }
  async submit(p: Purchase, i: Instrument, evidence?: Preflight): Promise<BrokerOrder> {
    this.guard(p);
    const frozen = p.instrumentSnapshot;
    if (!frozen || (["id", "issuer", "symbol", "conid", "exchange", "currency", "shareClass", "timezone", "evidence", "listing"] as const).some(key => frozen[key] !== i[key])) throw new Error("Frozen exact listing mismatch; never retarget.");
    if (!p.intentId || !i.conid || i.evidence === "fixture" || !p.contract || p.contract.evidence !== "broker-verified" || p.contract.conid !== i.conid || p.contract.currency !== i.currency || p.contract.exchange !== i.exchange) throw new Error("Durable intent and broker-verified contract required; fixture routing forbidden.");
    const timeReasons = evidenceTimeReasons(p, evidence, this.clock());
    if (timeReasons.length) throw new OrderNotSent(timeReasons.join(" "));
    const response = await this.transport("POST", `/iserver/account/${encodeURIComponent(this.accountId)}/orders`, { orders: [{ acctId: this.accountId, conid: i.conid, cOID: p.intentId, orderType: "LMT", side: "BUY", quantity: p.shares, price: p.limitPrice, tif: "DAY", outsideRTH: false }] });
    const rows = Array.isArray(response) ? response.map(cpRow) : [];
    // IBKR warning/reply IDs are not accepted orders. Never auto-confirm warnings.
    const row = rows.find(r => r.order_id || r.orderId);
    return { intentId: p.intentId, orderId: row ? orderId(row) : "", state: "unknown", filledShares: 0, spent: 0, feesKnown: false, executions: [] };
  }
  async reconcile(p: Purchase): Promise<BrokerOrder | null> {
    if (p.accountId !== this.accountId || p.accountMode !== this.mode || !p.intentId) return null;
    const instrument = p.contract;
    if (!instrument?.conid || instrument.evidence !== "broker-verified") return null;
    const response = cpRow(await this.transport("GET", `/iserver/account/orders?force=true&accountId=${encodeURIComponent(this.accountId)}`));
    const allOrders = Array.isArray(response.orders) ? response.orders.map(cpRow) : [];
    const candidates = allOrders.filter(r => related(r, p));
    const history = await this.transport("GET", "/iserver/account/trades?days=7");
    if (!Array.isArray(history)) return null;
    const allTrades = history.map(cpRow);
    const ids = new Set([...candidates, ...allTrades.filter(r => related(r, p))].map(orderId));
    if (p.brokerOrderId) ids.add(p.brokerOrderId);
    if (ids.size !== 1 || ids.has("")) return null;
    const id = [...ids][0];
    const orders = allOrders.filter(r => related(r, p) || orderId(r) === id);
    const trades = allTrades.filter(r => related(r, p) || orderId(r) === id);
    if (orders.length > 1) return null;
    // Completed orders may be absent from the live list; fetch exact status.
    const status = await this.transport("GET", `/iserver/account/order/status/${encodeURIComponent(id)}`)
      .then(cpRow).catch(error => { if (orders.length === 1) return orders[0]; throw error; });
    // Validate every live identity before using its exact cOID/reference to
    // link status responses that omit that optional field (normal IBKR shape).
    if (orders.some(r => !identity(r, p, instrument, id, true))) return null;
    const linked = status.cOID === undefined && status.order_ref === undefined && orders.some(r => r.cOID === p.intentId || r.order_ref === p.intentId)
      ? { ...status, order_ref: p.intentId } : status;
    return mapOrder(linked, trades, p, instrument);
  }
  async cancel(p: Purchase) {
    this.guard(p);
    if (!p.brokerOrderId) return null;
    await this.transport("DELETE", `/iserver/account/${encodeURIComponent(this.accountId)}/order/${encodeURIComponent(p.brokerOrderId)}`);
    return this.reconcile(p); // DELETE acknowledgment is not cancellation confirmation.
  }
}
