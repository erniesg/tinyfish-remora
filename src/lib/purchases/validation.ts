import type { Database } from "./store";
import { validateInput } from "./input";
import type { Execution } from "./types";

const fail = (): never => { throw new Error("Invalid purchase database; recovery required. No execution authority restored."); };
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const text = (v: unknown) => typeof v === "string" && v.length > 0;
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v as string));
const states = new Set(["draft", "armed", "waiting-for-listing", "waiting-for-opening", "blocked", "submitted", "partially-filled", "filled", "cancellation-pending", "cancelled", "expired", "revoked", "reconciliation-required"]);
const terminal = new Set(["filled", "cancelled", "expired", "revoked"]);
const active = new Set(["submitted", "partially-filled", "filled", "cancellation-pending", "reconciliation-required"]);
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
function executions(value: unknown, currency: string): Execution[] {
  if (!Array.isArray(value)) return fail(); // Legacy aggregate-only state needs explicit recovery.
  const ids = new Set<string>();
  for (const item of value) {
    const e = obj(item);
    if (!text(e.id) || ids.has(e.id as string) || !Number.isSafeInteger(e.quantity) || Number(e.quantity) <= 0 || !nonnegative(e.price) || e.price === 0 || (e.fee !== null && !nonnegative(e.fee)) || e.currency !== currency) fail();
    ids.add(e.id as string);
  }
  return value as Execution[];
}
const cost = (fills: Execution[]) => fills.reduce((n, e) => n + e.quantity * e.price + (e.fee ?? 0), 0);
const near = (a: number, b: number) => Math.abs(a - b) < 0.000001;
export function validateDatabase(value: unknown): asserts value is Database {
  try {
    const db = obj(value);
    if (db.version !== 1 || typeof db.killSwitch !== "boolean" || !Array.isArray(db.purchases) || (db.lastCheckAt !== undefined && !date(db.lastCheckAt))) fail();
    const orders = obj(db.mockOrders), ids = new Set<string>(), intents = new Set<string>(), brokerIds = new Set<string>();
    const owners = new Map<string, { currency: string; shares: number }>();
    for (const item of db.purchases as unknown[]) {
      const p = obj(item); validateInput(p);
      if (p.revision !== undefined && (!Number.isSafeInteger(p.revision) || Number(p.revision) < 0)) fail();
      const instrument = obj(p.instrumentSnapshot);
      if (instrument.id !== p.instrumentId || !["mock", "paper", "live"].includes(String(p.accountMode)) ||
        !["id", "issuer"].every(k => text(instrument[k])) || !["exchange", "currency", "shareClass", "timezone"].every(k => typeof instrument[k] === "string") ||
        (instrument.symbol !== null && !text(instrument.symbol)) ||
        (instrument.conid !== null && (!Number.isSafeInteger(instrument.conid) || Number(instrument.conid) <= 0)) ||
        !["fixture", "broker-verified"].includes(String(instrument.evidence)) ||
        !["verified", "unconfirmed", "ambiguous"].includes(String(instrument.listing)) ||
        !Array.isArray(instrument.supportedTriggers) || instrument.supportedTriggers.some(t => !["schedule", "opening", "first-trade"].includes(String(t))) || !strings(instrument.reasons)) fail();
      if (instrument.listing === "verified" && (!text(instrument.symbol) || !Number.isSafeInteger(instrument.conid) || Number(instrument.conid) <= 0 || !["exchange", "currency", "shareClass", "timezone"].every(k => text(instrument[k])))) fail();
      if (instrument.timezone) new Intl.DateTimeFormat("en-US", { timeZone: String(instrument.timezone) });
      if (instrument.listing !== "verified" && (p.reserved !== 0 || p.intentId !== undefined || p.filledShares !== 0 || p.spent !== 0)) fail();
      if ( !text(p.id) || ids.has(p.id as string) || !date(p.createdAt) || !states.has(String(p.state)) || !strings(p.reasons) || p.cancellationPolicy !== "cancel-remainder-at-expiry-or-session-end" || !Array.isArray(p.receipts) || (p.revoked !== undefined && typeof p.revoked !== "boolean") || (p.stopRequested !== undefined && !["revoked", "cancelled", "expired"].includes(String(p.stopRequested)))) fail();
      ids.add(p.id as string);
      if (!nonnegative(p.spent) || !nonnegative(p.reserved) || !Number.isSafeInteger(p.filledShares) || Number(p.filledShares) < 0 || Number(p.filledShares) > Number(p.shares) || p.spent > Number(p.maxSpend) || p.reserved > Number(p.maxSpend) || p.spent + p.reserved > Number(p.maxSpend) + 0.000001) fail();
      const fills = executions(p.executions, String(instrument.currency));
      if (fills.some(e => e.fee === null || e.price > Number(p.limitPrice)) || fills.reduce((n, e) => n + e.quantity, 0) !== p.filledShares || !near(Math.ceil(cost(fills) * 100) / 100, Number(p.spent))) fail();
      if (p.submitPhase !== undefined && (!p.intentId || !["prepared", "attempted"].includes(String(p.submitPhase)))) fail();
      if (p.submitPhase === "prepared" && (p.brokerOrderId !== undefined || p.filledShares !== 0 || p.spent !== 0 || !["reconciliation-required", "cancelled", "expired", "revoked"].includes(String(p.state)))) fail();
      if (p.intentId !== undefined) {
        if (!text(p.intentId) || intents.has(p.intentId as string) || ["draft", "armed", "waiting-for-listing", "waiting-for-opening", "blocked"].includes(String(p.state))) fail();
        const contract = obj(p.contract);
        if (!Number.isSafeInteger(contract.conid) || Number(contract.conid) <= 0 || instrument.listing !== "verified" || contract.conid !== instrument.conid || contract.currency !== instrument.currency || contract.exchange !== instrument.exchange || contract.evidence !== instrument.evidence) fail();
        intents.add(p.intentId as string); owners.set(p.intentId as string, { currency: String(instrument.currency), shares: Number(p.shares) });
      } else if (p.contract !== undefined || active.has(String(p.state)) || p.brokerOrderId !== undefined || p.filledShares !== 0 || p.spent !== 0) fail();
      if (p.brokerOrderId !== undefined) {
        if (!text(p.brokerOrderId) || brokerIds.has(p.brokerOrderId as string)) fail();
        brokerIds.add(p.brokerOrderId as string);
      }
      if (terminal.has(String(p.state)) && p.reserved !== 0) fail();
      if (p.state === "filled" && (p.filledShares !== p.shares || !p.brokerOrderId)) fail();
      if (p.intentId && !terminal.has(String(p.state)) && !near(Number(p.spent) + Number(p.reserved), Number(p.maxSpend))) fail();
      if (p.state === "armed" && (p.reserved !== p.maxSpend || p.stopRequested || instrument.listing !== "verified")) fail();
      if (p.state === "draft" && p.reserved !== 0) fail();
      const intentReceipts = (p.receipts as unknown[]).filter(r => obj(r).kind === "intent-created").length;
      if (intentReceipts !== (p.intentId ? 1 : 0)) fail();
      if ((Number(p.reserved) > 0 || p.intentId) && Math.ceil((Number(p.shares) * Number(p.limitPrice) + Number(p.buffer)) * 100) / 100 > Number(p.maxSpend)) fail();
      for (const entry of p.receipts as unknown[]) {
        const r = obj(entry);
        if (!date(r.at) || !text(r.kind) || typeof r.message !== "string" || !["mock", "broker"].includes(String(r.evidence))) fail();
      }
    }
    const executionIds = new Set<string>(), orderIds = new Set<string>();
    for (const [key, item] of Object.entries(orders)) {
      const o = obj(item), owner = owners.get(key);
      if ((db.purchases as Record<string, unknown>[]).some(p => p.intentId === key && p.submitPhase === "prepared")) fail();
      if (!owner || o.intentId !== key || !text(o.orderId) || orderIds.has(o.orderId as string) || !["submitted", "partially-filled", "filled", "cancelled", "rejected", "unknown"].includes(String(o.state)) || !Number.isSafeInteger(o.filledShares) || Number(o.filledShares) < 0 || Number(o.filledShares) > owner!.shares || (o.state === "filled" && o.filledShares !== owner!.shares) || !nonnegative(o.spent) || typeof o.feesKnown !== "boolean") fail();
      orderIds.add(o.orderId as string);
      const fills = executions(o.executions, owner!.currency);
      if (fills.reduce((n, e) => n + e.quantity, 0) !== o.filledShares || !near(cost(fills), Number(o.spent)) || (o.feesKnown && fills.some(e => e.fee === null))) fail();
      for (const e of fills) { if (executionIds.has(e.id)) fail(); executionIds.add(e.id); }
    }
  } catch { fail(); }
}
