import type { BrokerOrder } from "./broker";
import type { Execution, Instrument, Purchase } from "./types";

// Public official references inspected 2026-11-13 (no brokerage requests):
// /docs/web-api/api-reference/trading/trading-orders/get-trade-history
// /docs/web-api/api-reference/trading/trading-orders/get-order-status
// Trades provide per-execution string price/commission, not avgPrice/totalFees.
// History is limited to seven days. Absence is never cancellation/non-submission.
export type CPRow = Record<string, unknown>;
export const cpRow = (v: unknown): CPRow => v !== null && typeof v === "object" && !Array.isArray(v) ? v as CPRow : {};
export const cpNumber = (v: unknown): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || !/^-?\d+(\.\d+)?$/.test(v))) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
export const orderId = (r: CPRow) => String(r.orderId ?? r.order_id ?? "");
export const related = (r: CPRow, p: Purchase) => r.cOID === p.intentId || r.order_ref === p.intentId || (!!p.brokerOrderId && orderId(r) === p.brokerOrderId);
const aliases = (r: CPRow, keys: string[], expected: string, required = true) => {
  const values = keys.filter(k => r[k] !== undefined).map(k => String(r[k]));
  return (!required || values.length > 0) && values.every(v => v === expected);
};
export function identity(r: CPRow, p: Purchase, i: Pick<Instrument, "conid" | "currency">, id: string, currencyRequired: boolean) {
  return !!id && aliases(r, ["orderId", "order_id"], id) &&
    (!p.brokerOrderId || id === p.brokerOrderId) &&
    aliases(r, ["account", "accountCode", "account_allocation_name", "acct", "acctId"], p.accountId) &&
    aliases(r, ["conid"], String(i.conid)) &&
    ["conidEx", "conidex"].every(k => r[k] === undefined || String(r[k]).split("@")[0] === String(i.conid)) &&
    ["BUY", "B"].includes(String(r.side)) &&
    aliases(r, ["currency", "cashCcy"], i.currency, currencyRequired) &&
    aliases(r, ["cOID", "order_ref"], p.intentId!, false);
}
export function mapOrder(status: CPRow, trades: CPRow[], p: Purchase, i: Pick<Instrument, "conid" | "currency">): BrokerOrder | null {
  const id = orderId(status);
  if (!p.intentId || !identity(status, p, i, id, true)) return null;
  // At least one exact client reference is mandatory; numeric order IDs alone
  // cannot certify intent. Status often omits the ref; history then supplies it.
  if (![status, ...trades].some(r => r.cOID === p.intentId || r.order_ref === p.intentId)) return null;
  const executions = new Map<string, Execution>();
  for (const r of trades) {
    if (!identity(r, p, i, id, false) || r.order_ref !== p.intentId || typeof r.execution_id !== "string" || !r.execution_id) return null;
    const quantity = cpNumber(r.size), price = cpNumber(r.price), fee = cpNumber(r.commission);
    if (quantity === null || !Number.isSafeInteger(quantity) || quantity <= 0 || price === null || price <= 0 || (fee !== null && fee < 0)) return null;
    // Official trade rows omit currency. It is bound by exact order/status
    // account+conid+BUY+ID above; a supplied currency must match as well.
    const execution = { id: r.execution_id, quantity, price, fee, currency: i.currency };
    const existing = executions.get(execution.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(execution)) return null;
    executions.set(execution.id, execution);
  }
  const fills = [...executions.values()];
  const quantity = fills.reduce((n, e) => n + e.quantity, 0);
  const reported = cpNumber(status.cum_fill ?? status.filledQuantity ?? status.filled);
  if (reported === null || !Number.isSafeInteger(reported) || reported < 0) return null;
  const complete = reported === quantity;
  const feesKnown = complete && fills.every(e => e.fee !== null);
  const state = String(status.order_status ?? status.status ?? "").toLowerCase();
  return { intentId: p.intentId, orderId: id,
    state: state === "filled" ? "filled" : ["cancelled", "canceled"].includes(state) ? "cancelled" : state === "rejected" ? "rejected" : reported > 0 ? "partially-filled" : ["submitted", "presubmitted"].includes(state) ? "submitted" : "unknown",
    filledShares: reported, executions: fills, feesKnown,
    spent: fills.reduce((n, e) => n + e.quantity * e.price + (e.fee ?? 0), 0) };
}
