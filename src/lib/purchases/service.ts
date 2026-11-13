import { randomUUID } from "node:crypto";
import { catalog, fixtureMarket, localTime, resolveContract } from "./catalog";
import { MockBroker, mockAccount } from "./broker";
import type { Broker, BrokerOrder, Preflight } from "./broker";
import { PurchaseStore } from "./store";
import { validateInput } from "./input";
import type { Transaction } from "./store";
import type { AccountStatus, Execution, Instrument, MandateInput, Preview, Purchase, PurchaseDashboard } from "./types";

const terminal = new Set(["filled", "cancelled", "expired", "revoked"]);
const active = new Set(["submitted", "partially-filled", "cancellation-pending", "reconciliation-required"]);
const money = (value: number) => Math.ceil(value * 100) / 100;
export { validateInput } from "./input";
export interface PurchaseContext { catalog: Instrument[]; account: AccountStatus }
const mockContext: PurchaseContext = { catalog, account: mockAccount };
const sameListing = (a: Instrument, b: Instrument) =>
  (["id", "issuer", "symbol", "conid", "exchange", "currency", "shareClass", "timezone", "evidence", "listing"] as const).every(key => a[key] === b[key]);
export function preview(input: MandateInput, now = new Date(), context: PurchaseContext = mockContext): Preview {
  const { account } = context;
  const selected = context.catalog.filter(i => i.id === input.instrumentId);
  const resolution = resolveContract(selected);
  const instrument = selected[0] ?? null;
  const reasons = [...resolution.reasons];
  if (instrument && !instrument.supportedTriggers.includes(input.trigger)) reasons.push("This listing does not support the selected trigger.");
  if (input.accountId !== account.id) reasons.push("Select the exact server-configured account; no account substitution is authorised.");
  if (instrument && !Object.hasOwn(account.cashBalances, instrument.currency)) reasons.push(`No ${instrument.currency} cash balance; no FX conversion or borrowing is authorised.`);
  if (instrument && !account.permissions.includes(`${instrument.exchange}:STK`)) reasons.push("Trading permission for this venue is unavailable in the local account.");
  if (Date.parse(input.expiresAt) <= now.getTime()) reasons.push("Mandate has expired.");
  if (instrument?.evidence === "fixture") {
    const target = new Date(input.scheduledAt);
    const market = fixtureMarket(instrument, target);
    const targetDate = localTime(target, instrument.timezone).date;
    const currentDate = localTime(now, instrument.timezone).date;
    if (market.closedForDay || currentDate > targetDate || (currentDate === targetDate && fixtureMarket(instrument, now).closedForDay)) reasons.push("The selected exchange session is closed or already ended. Choose a trading day and a start time before its close; purchases never roll to a later session.");
  }
  const estimatedMaximum = money(input.shares * input.limitPrice + input.buffer);
  if (estimatedMaximum > input.maxSpend) reasons.push("Maximum spend must cover all shares at the limit plus the fees/FX buffer.");
  const cash = account.cashBalances[instrument?.currency ?? ""] ?? 0;
  if (!Number.isFinite(cash) || cash < 0 || input.maxSpend > cash) reasons.push("Insufficient or unknown available cash in the listing currency.");
  return { supported: reasons.length === 0, reasons, estimatedMaximum, instrument: instrument ? structuredClone(instrument) : null };
}
function receipt(p: Purchase, broker: Broker, now: Date, kind: string, message: string) {
  const previous = p.receipts.at(-1);
  if (previous?.kind !== kind || previous.message !== message) p.receipts.push({ at: now.toISOString(), kind, message, evidence: broker.evidence });
}
function preflightReasons(p: Purchase, instrument: Instrument, f: Preflight, now: Date): string[] {
  const reasons = [...f.reasons];
  if (f.accountId !== p.accountId || f.accountMode !== p.accountMode) reasons.push("Broker account or account mode mismatch.");
  if (p.accountMode !== "mock") {
    if (f.venueOrderSupported !== true) reasons.push("Exact venue regular-session DAY limit-order eligibility unknown or unsupported.");
    if (f.quantitySupported !== true) reasons.push("Exact whole-share order quantity eligibility unknown or unsupported.");
    if (f.priceUnitVerified !== true) reasons.push("Listing price-unit/currency conversion evidence unknown.");
    if (f.feeBound == null || !Number.isFinite(f.feeBound) || f.feeBound < 0) reasons.push("Conservative total fee bound unknown.");
    else if (f.feeBound > p.buffer) reasons.push("Conservative total fee bound exceeds the mandate buffer.");
  }
  if (!f.authenticated) reasons.push("Interactive broker authentication required.");
  if (!f.sessionReady) reasons.push("Broker session unavailable or competing session active.");
  if (!f.permitted) reasons.push("Missing exchange/product trading permission.");
  if (!f.cashSettled) reasons.push("Settled cash evidence is unavailable; no borrowing or unsettled-cash assumption.");
  if (f.currency !== instrument.currency || f.quoteCurrency !== instrument.currency) reasons.push("Cash/quote currency mismatch; automatic FX and borrowing are disabled.");
  if (!f.dataEntitled) reasons.push("Quote entitlement unavailable.");
  const quoteAge = f.quoteAt ? now.getTime() - Date.parse(f.quoteAt) : NaN;
  if (!Number.isFinite(quoteAge) || quoteAge < -1000 || quoteAge > 30000 || !f.quote || !Number.isFinite(f.quote) || f.quote <= 0) reasons.push("Quote is missing, stale or invalid.");
  if (f.quote && f.quote > p.limitPrice) reasons.push("Current quote exceeds the approved limit price.");
  if (!f.calendarKnown) reasons.push("Exchange calendar/session evidence unavailable.");
  if (f.halted) reasons.push("Instrument is halted.");
  if (money(p.shares * p.limitPrice + p.buffer) > p.maxSpend) reasons.push("Price/quantity/buffer exceeds mandate budget.");
  return reasons;
}
const sameExecution = (a: Execution | undefined, b: Execution) => !!a && a.id === b.id && a.quantity === b.quantity && a.price === b.price && a.fee === b.fee && a.currency === b.currency;
function applyOrder(p: Purchase, order: BrokerOrder, broker: Broker, now: Date) {
  const currency = p.instrumentSnapshot.currency;
  const fills = new Map<string, BrokerOrder["executions"][number]>();
  let invalid = !Array.isArray(order.executions);
  for (const e of order.executions ?? []) {
    const prior = fills.get(e.id);
    if (!e.id || !Number.isSafeInteger(e.quantity) || e.quantity <= 0 || !Number.isFinite(e.price) || e.price <= 0 || e.price > p.limitPrice || e.currency !== currency || (e.fee !== null && (!Number.isFinite(e.fee) || e.fee < 0)) || (prior && !sameExecution(prior, e))) invalid = true;
    fills.set(e.id, e);
  }
  const executions = [...fills.values()];
  const quantity = executions.reduce((n, e) => n + e.quantity, 0);
  const cost = executions.reduce((n, e) => n + e.quantity * e.price + (e.fee ?? 0), 0);
  if (p.executions.some(e => !sameExecution(fills.get(e.id), e))) invalid = true;
  if (order.feesKnown && (quantity !== order.filledShares || executions.some(e => e.fee === null) || Math.abs(cost - order.spent) > 0.000001)) invalid = true;
  if (order.intentId === p.intentId && order.orderId && (!p.brokerOrderId || p.brokerOrderId === order.orderId)) p.brokerOrderId = order.orderId;
  if (invalid || (p.brokerOrderId && p.brokerOrderId !== order.orderId) || order.intentId !== p.intentId || !order.orderId || !Number.isSafeInteger(order.filledShares) || order.filledShares < p.filledShares || order.filledShares > p.shares || !Number.isFinite(order.spent) || money(order.spent) < p.spent || order.spent > p.maxSpend || (order.filledShares > 0 && order.spent > order.filledShares * p.limitPrice + p.buffer)) {
    p.state = "reconciliation-required"; p.reasons = ["Broker evidence violates identity, fill, price or budget bounds; reservation retained."];
    receipt(p, broker, now, "execution-evidence-rejected", JSON.stringify({ orderId: order.orderId, filledShares: order.filledShares, spent: order.spent, executions: order.executions, reason: p.reasons[0] }));
    return;
  }
  p.brokerOrderId = order.orderId;
  if (!order.feesKnown) { p.state = "reconciliation-required"; p.reasons = ["Broker fees/execution cost not confirmed; budget reservation retained."]; return; }
  p.filledShares = order.filledShares;
  p.executions = executions;
  p.spent = money(order.spent);
  p.reserved = Math.max(0, p.maxSpend - p.spent);
  if (order.state === "unknown") { p.state = "reconciliation-required"; p.reasons = ["Broker outcome unknown; never resubmit this intent."]; }
  else if (order.state === "rejected") { p.state = "cancelled"; p.reserved = 0; p.reasons = ["Broker rejected the order; no automatic replacement."]; }
  else if (order.state === "filled" && order.filledShares !== p.shares) { p.state = "reconciliation-required"; p.reasons = ["Inconsistent filled quantity; reservation retained."]; }
  else {
    p.state = p.stopRequested && !terminal.has(order.state) ? "cancellation-pending" : order.state;
    p.reasons = [];
    if (terminal.has(p.state)) p.reserved = 0;
  }
  receipt(p, broker, now, p.state, `Order ${order.orderId}: ${p.filledShares}/${p.shares} shares; confirmed spend ${p.spent}.`);
}
export class PurchaseService {
  constructor(readonly store: PurchaseStore, private brokerFactory: (tx: Transaction) => Broker = tx => new MockBroker(tx), private clock: () => Date = () => new Date(), private context: PurchaseContext = mockContext) {
    this.context = structuredClone(context);
  }
  preview(input: MandateInput, now = this.clock()) { return preview(input, now, this.context); }
  async dashboard(enabled: boolean): Promise<PurchaseDashboard> {
    const data = await this.store.load();
    const age = data.lastCheckAt ? this.clock().getTime() - Date.parse(data.lastCheckAt) : NaN;
    return { scheduler: { lastCheckAt: data.lastCheckAt ?? null, checkedRecently: Number.isFinite(age) && age >= 0 && age < 15000 }, mode: enabled ? this.context.account.mode : "disabled", mutationEnabled: enabled, evidence: this.context.account.mode === "mock" ? "mock" : "broker", catalog: structuredClone(this.context.catalog), account: structuredClone(this.context.account), purchases: data.purchases, killSwitch: data.killSwitch, capabilities: ["schedule", "opening", "first-trade"].map(trigger => ({ trigger: trigger as MandateInput["trigger"], supported: true, reasons: [this.context.account.mode === "mock" ? "Local deterministic regular-session limit-order simulation only; no auction/first-price guarantee." : "Requires exact listing, current preflight proof and explicit injected execution authority; no auction/first-price guarantee."] })), notices: this.context.account.mode !== "mock" ? ["Server-injected account context. Routing requires separate explicit broker authority and current verified evidence.", "IPO subscription remains unsupported; public API and worker remain mock-only."] : ["All account, contract, calendar, quote and receipt evidence is simulated, not IBKR paper or live proof.", "IPO subscription is not implemented; offering/entity eligibility and API support remain unverified. Secondary-market simulation is independent.", "Live and actual paper execution are held. No broker connection is made.", "Fixture calendars cover weekends and selected 2026 holidays only; not authoritative exchange calendars."] };
  }
  async create(value: unknown) {
    const input = validateInput(value);
    return this.store.transaction(async tx => {
      const now = this.clock();
      const selected = this.context.catalog.filter(i => i.id === input.instrumentId);
      if (selected.length !== 1) throw new Error("Unknown or ambiguous instrument; select an exact catalog listing.");
      const p: Purchase = { ...input, instrumentSnapshot: structuredClone(selected[0]), accountMode: this.context.account.mode, id: randomUUID(), createdAt: now.toISOString(), state: "draft", cancellationPolicy: "cancel-remainder-at-expiry-or-session-end", reasons: this.preview(input, now).reasons, filledShares: 0, spent: 0, reserved: 0, receipts: [], executions: [] };
      receipt(p, this.brokerFactory(tx), now, "created", "Bounded mandate saved. Not armed.");
      tx.data.purchases.push(p);
      return p;
    });
  }
  async action(id: string, action: "arm" | "revoke" | "cancel" | "refresh") {
    return this.store.transaction(async tx => {
      const p = tx.data.purchases.find(x => x.id === id);
      if (!p) throw new Error("Purchase not found.");
      const broker = this.brokerFactory(tx), now = this.clock();
      if (action === "refresh") {
        if (p.intentId && !terminal.has(p.state)) await this.reconcile(p, broker, now);
      } else if (action === "arm") {
        if (p.intentId || p.revoked || terminal.has(p.state)) throw new Error("This mandate cannot be rearmed or replaced. Create a new bounded mandate only after reconciliation.");
        const result = this.preview(p, now);
        const currency = p.instrumentSnapshot.currency;
        const reserved = tx.data.purchases.filter(x => x.id !== p.id && x.instrumentSnapshot.currency === currency).reduce((n, x) => n + x.reserved + x.spent, 0);
        const reasons = [...result.reasons];
        if (!result.instrument || !sameListing(p.instrumentSnapshot, result.instrument) || p.accountMode !== this.context.account.mode) reasons.push("Frozen listing/account mode no longer matches trusted context; create a new mandate, never retarget.");
        if (tx.data.killSwitch) reasons.push("Kill switch is enabled.");
        if (!Number.isFinite(reserved) || money(reserved + p.maxSpend) > (this.context.account.cashBalances[currency ?? ""] ?? 0)) reasons.push("Available cash is reserved by other mandates.");
        if (reasons.length) { p.state = result.instrument?.listing === "unconfirmed" ? "waiting-for-listing" : "blocked"; p.reasons = reasons; p.reserved = 0; }
        else { p.state = "armed"; p.reserved = p.maxSpend; p.reasons = []; }
        receipt(p, broker, now, p.state, reasons.join(" ") || "Bounded mandate armed for unattended execution within the injected authority.");
      } else {
        p.revoked = true;
        await tx.save(); // Persist revocation before any broker cancellation.
        await this.stop(p, broker, now, action === "revoke" ? "revoked" : "cancelled", tx);
      }
      return p;
    });
  }
  async kill(enabled: boolean) {
    return this.store.transaction(async tx => {
      tx.data.killSwitch = enabled;
      if (enabled) for (const p of tx.data.purchases) if (!terminal.has(p.state)) p.revoked = true;
      await tx.save(); // A crash cannot silently clear the kill/revocation boundary.
      if (enabled) for (const p of tx.data.purchases) if (!terminal.has(p.state)) await this.stop(p, this.brokerFactory(tx), this.clock(), "revoked", tx);
      return enabled;
    });
  }
  private async reconcile(p: Purchase, broker: Broker, now: Date) {
    try {
      const result = await broker.reconcile(p);
      if (result) applyOrder(p, result, broker, now);
      else { p.state = "reconciliation-required"; p.reasons = ["No conclusive broker evidence. Reservation retained; no replacement or resubmission."]; }
    } catch { p.state = "reconciliation-required"; p.reasons = ["Broker reconciliation unavailable; reservation retained."]; }
  }
  private async stop(p: Purchase, broker: Broker, now: Date, state: "revoked" | "cancelled" | "expired", tx: Transaction) {
    if (terminal.has(p.state)) return;
    p.stopRequested ??= state;
    if (!p.intentId) { p.state = state; p.reserved = 0; p.reasons = [state === "expired" ? "Mandate or approved session expired; no rollover." : "Mandate stopped."]; }
    else {
      p.state = "cancellation-pending";
      receipt(p, broker, now, "cancellation-pending", `${state}: cancellation requested; acceptance is not confirmation.`);
      await tx.save(); // Persist stop intent before reconciliation/cancellation effects.
      // Unknown submissions must be discovered before ID-dependent cancellation.
      await this.reconcile(p, broker, now);
      if (terminal.has(p.state)) return;
      try { const order = await broker.cancel(p); if (order) applyOrder(p, order, broker, now); } catch { p.reasons = ["Cancellation outcome unknown; reconciliation required before releasing cash."]; }
      if (!terminal.has(p.state)) { p.state = "cancellation-pending"; p.reasons = ["Awaiting confirmed cancellation or final fill; reservation retained."]; }
    }
    receipt(p, broker, now, p.state, `${state}: ${p.reasons.join(" ")}`);
  }
  async tick() {
    return this.store.transaction(async tx => {
      const broker = this.brokerFactory(tx), now = this.clock();
      for (const p of tx.data.purchases) {
        if (terminal.has(p.state)) continue;
        const instrument = p.instrumentSnapshot;
        const sessionDate = localTime(new Date(p.scheduledAt), instrument.timezone).date;
        const currentDate = localTime(now, instrument.timezone).date;
        if (p.stopRequested || tx.data.killSwitch || p.revoked || now.getTime() >= Date.parse(p.expiresAt) || currentDate > sessionDate) {
          await this.stop(p, broker, now, p.stopRequested ?? (p.revoked || tx.data.killSwitch ? "revoked" : "expired"), tx); continue;
        }
        if (p.state === "draft" || p.state === "waiting-for-listing") continue;
        if (p.intentId || active.has(p.state)) {
          await this.reconcile(p, broker, now);
          if (!terminal.has(p.state)) {
            const f = await broker.preflight(p, instrument, now).catch(() => null);
            if (!f || f.halted || f.closedForDay || p.state === "cancellation-pending") await this.stop(p, broker, now, "cancelled", tx);
          }
          continue;
        }
        // A blocked unarmed mandate has no reservation and cannot self-authorise.
        if (p.reserved <= 0 || Date.parse(p.scheduledAt) > now.getTime()) continue;
        const current = this.context.catalog.filter(i => i.id === p.instrumentId);
        if (current.length !== 1 || !sameListing(instrument, current[0]) || p.accountId !== this.context.account.id || p.accountMode !== this.context.account.mode) {
          p.state = "blocked"; p.reasons = ["Frozen listing/account mode no longer matches trusted context; reservation retained, never retarget."]; continue;
        }
        const resolution = resolveContract([instrument]);
        if (!resolution.instrument) { p.state = "waiting-for-listing"; p.reasons = resolution.reasons; continue; }
        let f: Preflight;
        try { f = await broker.preflight(p, instrument, now); } catch { p.state = "blocked"; p.reasons = ["Broker preflight unavailable."]; continue; }
        const reasons = preflightReasons(p, instrument, f, now);
        if (!current[0].supportedTriggers.includes(p.trigger)) reasons.push("Selected trigger is no longer supported by the trusted listing context.");
        if ((broker.evidence === "mock") !== (p.accountMode === "mock")) reasons.push("Broker evidence mode does not match the frozen account mode.");
        const committed = tx.data.purchases.filter(x => x.instrumentSnapshot.currency === instrument.currency).reduce((n, x) => n + x.spent + x.reserved, 0);
        if (!Number.isFinite(committed) || !Number.isFinite(f.availableCash) || f.availableCash < 0 || committed > f.availableCash) reasons.push("Insufficient unreserved cash for aggregate mandates.");
        if (reasons.length) { p.state = "blocked"; p.reasons = reasons; continue; }
        if (f.closedForDay) { await this.stop(p, broker, now, "expired", tx); continue; }
        if (!f.open || !f.firstTrade) { p.state = "waiting-for-opening"; p.reasons = ["Waiting for broker-confirmed regular session and instrument tradability; exchange opening alone is insufficient."]; continue; }
        p.contract = { conid: instrument.conid, exchange: instrument.exchange, currency: instrument.currency, evidence: instrument.evidence };
        p.intentId = randomUUID();
        p.state = "reconciliation-required";
        p.reasons = ["Durable intent persisted before submit. Unknown outcomes must reconcile, never resubmit."];
        receipt(p, broker, now, "intent-created", p.reasons[0]);
        await tx.save();
        try { applyOrder(p, await broker.submit(p, instrument), broker, now); }
        catch { p.state = "reconciliation-required"; p.reasons = ["Submission response unavailable. Reconcile by durable intent; no automatic retry."]; }
        await tx.save();
      }
      tx.data.lastCheckAt = now.toISOString();
      return tx.data.purchases;
    });
  }
}
