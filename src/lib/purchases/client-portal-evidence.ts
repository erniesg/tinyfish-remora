import type { ClientPortalEvidence, ClientPortalTransport, Preflight } from "./broker";
import type { Instrument, Purchase } from "./types";

/** Official protocol references (public documentation inspected 2026-11-13):
 * https://www.interactivebrokers.com/docs/web-api/api-reference/trading/trading-contracts/get-contract-symbols
 * https://www.interactivebrokers.com/docs/web-api/api-reference/trading/trading-contracts/get-contract-info
 * https://www.interactivebrokers.com/docs/web-api/api-reference/trading/trading-portfolio/get-portfolio-ledger
 * https://www.interactivebrokers.com/docs/web-api/api-reference/trading/trading-market-data/get-md-snapshot
 * https://www.interactivebrokers.com/docs/web-api/v1/endpoints/contract/trading-schedule-new
 * Paths are relative to the injected transport's /v1/api base. No login, default
 * fetch, order, FX, or account mutation. Snapshot GET can establish a data stream;
 * the caller owns session setup (/iserver/accounts first) and transport authority.
 * Broker contract names are NOT issuer/share-class/listing or halt/permission proof.
 */
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const number = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positive = (value: unknown) => { const n = number(value); return n !== null && n > 0 ? n : null; };

export interface VerifiedSource {
  source: string;
  observedAt: string;
  validUntil: string;
}
/** Supplied by a trusted listing verifier, never inferred from a search ticker.
 * Exact conid mapping must itself be verified against the original issuer listing.
 */
export interface VerifiedListing extends VerifiedSource {
  issuer: string; symbol: string; conid: number; exchange: string;
  currency: string; shareClass: string; timezone: string;
}
export interface VerifiedTradingState extends VerifiedSource {
  accountId: string; conid: number; exchange: string; currency: string;
  permitted: boolean; halted: boolean; firstTrade: boolean;
  /** Independently verified for this exact regular-session DAY LMT whole-share purchase.
   * Not inferred from generic trading permission or undocumented broker fields. */
  venueOrderSupported?: boolean; quantitySupported?: boolean; priceUnitVerified?: boolean;
  feeBound?: number | null;
}
export interface EvidenceInputs {
  /** Verified account configuration; never inferred from an account ID prefix. */
  accountMode: "paper" | "live";
  listing(instrument: Instrument, now: Date): Promise<VerifiedListing | null>;
  tradingState(purchase: Purchase, instrument: Instrument, now: Date): Promise<VerifiedTradingState | null>;
}
export type ContractResolution =
  | { status: "resolved"; instrument: Instrument; reasons: [] }
  | { status: "blocked" | "ambiguous" | "waiting-for-listing"; instrument: null; reasons: string[] };
const fresh = (proof: VerifiedSource | null, now: Date) => !!proof && !!proof.source.trim() &&
  Number.isFinite(Date.parse(proof.observedAt)) && Date.parse(proof.observedAt) <= now.getTime() &&
  Date.parse(proof.validUntil) > now.getTime() && Date.parse(proof.validUntil) > Date.parse(proof.observedAt);
const listingMatches = (p: VerifiedListing, i: Instrument) => p.issuer === i.issuer && p.symbol === i.symbol &&
  p.conid === i.conid && p.exchange === i.exchange && p.currency === i.currency && p.shareClass === i.shareClass && p.timezone === i.timezone;

/** Resolves from the original issuer, not a guessed symbol. Multiple candidates
 * require independently verified exact listing evidence, never first-result wins.
 */
export async function resolveClientPortalContract(transport: ClientPortalTransport, issuer: string, proof: VerifiedListing | null, now: Date): Promise<ContractResolution> {
  const blocked = (reason: string): ContractResolution => ({ status: "blocked", instrument: null, reasons: [reason] });
  if (!issuer.trim()) return blocked("Original issuer is required.");
  try {
    const response = await transport("GET", `/iserver/secdef/search?symbol=${encodeURIComponent(issuer)}&name=true&secType=STK`);
    if (!Array.isArray(response)) return blocked("Malformed contract search response.");
    const stocks = response.map(row).filter(r => Array.isArray(r.sections) && r.sections.some(s => row(s).secType === "STK"));
    if (!stocks.length) return { status: "waiting-for-listing", instrument: null, reasons: ["No confirmed public stock listing found; no ticker inferred."] };
    if (!fresh(proof, now) || proof!.issuer !== issuer) return { status: stocks.length > 1 ? "ambiguous" : "blocked", instrument: null, reasons: ["Verified original issuer, exact listing and share-class evidence required."] };
    const p = proof!;
    if (!Number.isSafeInteger(p.conid) || p.conid <= 0 || ![p.symbol, p.exchange, p.currency, p.shareClass, p.timezone].every(x => x.trim())) return blocked("Incomplete verified listing identity.");
    const candidates = stocks.filter(r => number(r.conid) === p.conid && r.symbol === p.symbol);
    if (candidates.length !== 1) return blocked("Verified listing does not uniquely match search contract.");
    const info = await transport("GET", `/iserver/secdef/info?conid=${p.conid}&sectype=STK&exchange=${encodeURIComponent(p.exchange)}`);
    // Current reference shows an object; older gateways return an array.
    const matches = (Array.isArray(info) ? info : [info]).map(row).filter(r =>
      number(r.conid) === p.conid && r.secType === "STK" && r.ticker === p.symbol && r.listingExchange === p.exchange && r.currency === p.currency);
    if (matches.length !== 1) return blocked("Stock contract detail does not uniquely match verified exchange/currency/listing.");
    return { status: "resolved", reasons: [], instrument: { id: `ibkr-${p.conid}-${p.exchange}`, issuer, symbol: p.symbol, conid: p.conid, exchange: p.exchange, currency: p.currency, shareClass: p.shareClass, timezone: p.timezone, evidence: "broker-verified", listing: "verified", supportedTriggers: ["schedule", "opening", "first-trade"], reasons: ["Contract matched to supplied verified listing; trigger eligibility requires current preflight evidence."] } };
  } catch { return blocked("Contract evidence request failed; listing remains blocked."); }
}

export interface CalendarEvidence {
  calendarKnown: boolean; open: boolean; closedForDay: boolean; reasons: string[];
  sessionOpensAt?: string; sessionClosesAt?: string;
}
const dateKey = (now: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("");
};
/** liquid_hours opening/closing are epoch SECONDS, not HHmm or milliseconds.
 * Missing dates inside the returned six-day horizon are non-trading days. Missing
 * dates outside that horizon are unknown, never an invented future holiday.
 */
export function clientPortalCalendar(response: unknown, now: Date): CalendarEvidence {
  const unknown = { calendarKnown: false, open: false, closedForDay: false, reasons: ["Missing, malformed or out-of-horizon broker calendar."] };
  try {
    const r = row(response);
    if (typeof r.exchange_time_zone !== "string") return unknown;
    const today = dateKey(now, r.exchange_time_zone);
    const schedules = row(r.schedules), dates = Object.keys(schedules).sort();
    if (!dates.length || dates.some(d => !/^\d{8}$/.test(d)) || today < dates[0] || today > dates[dates.length - 1]) return unknown;
    const intervals: { opening: number; closing: number }[] = [];
    for (const date of dates) {
      const hours = row(schedules[date]).liquid_hours;
      if (!Array.isArray(hours)) return unknown;
      for (const h of hours) {
        const opening = positive(row(h).opening), closing = positive(row(h).closing);
        if (!opening || !closing || !Number.isInteger(opening) || !Number.isInteger(closing) || opening >= closing || closing > 1e11) return unknown;
        if (date === today) intervals.push({ opening, closing });
      }
    }
    const t = now.getTime() / 1000;
    const current = intervals.find(h => t >= h.opening && t < h.closing);
    return { calendarKnown: true, open: !!current, closedForDay: !intervals.length || intervals.every(h => t >= h.closing), reasons: [],
      sessionOpensAt: current ? new Date(current.opening * 1000).toISOString() : undefined,
      sessionClosesAt: current ? new Date(current.closing * 1000).toISOString() : undefined };
  } catch { return unknown; }
}

/** Compatible with ClientPortalBroker's evidence argument. Authentication and
 * account visibility are checked by that broker, not certified by this adapter.
 * This read-only implementation ALWAYS holds execution authority. Integrators
 * must keep any separate execution grant outside this evidence collector.
 */
export class ClientPortalReadonlyEvidence implements ClientPortalEvidence {
  constructor(private transport: ClientPortalTransport, private accountId: string, private inputs: EvidenceInputs, private maxQuoteAgeMs = 30_000) {
    if (!Number.isFinite(maxQuoteAgeMs) || maxQuoteAgeMs <= 0) throw new Error("Positive quote freshness limit required.");
  }
  executionAllowed(): boolean { return false; }
  async preflight(p: Purchase, i: Instrument, now: Date): Promise<Preflight> {
    const result: Preflight = { accountId: this.accountId, accountMode: this.inputs.accountMode, currency: i.currency, availableCash: 0, cashSettled: false, quoteCurrency: i.currency,
      authenticated: true, sessionReady: true, permitted: false, dataEntitled: false,
      quote: null, quoteAt: null, calendarKnown: false, open: false, firstTrade: false,
      halted: true, closedForDay: false, reasons: [] };
    // true auth/session above are neutral inputs to Broker's AND checks, not
    // standalone session proof. Never use this collector as a broker itself.
    if (p.accountId !== this.accountId || i.evidence !== "broker-verified" || i.listing !== "verified" || !i.conid) {
      result.reasons.push("Exact account and non-fixture verified listing required.");
      return result;
    }
    try {
      const proof = await this.inputs.listing(i, now);
      if (!fresh(proof, now) || !listingMatches(proof!, i)) {
        result.reasons.push("Current exact issuer/listing/share-class evidence missing or mismatched."); return result;
      }
      const resolution = await resolveClientPortalContract(this.transport, i.issuer, proof, now);
      if (resolution.status !== "resolved") { result.reasons.push(...resolution.reasons); return result; }
      const state = await this.inputs.tradingState(p, i, now);
      if (fresh(state, now) && state!.accountId === p.accountId && state!.conid === i.conid && state!.exchange === i.exchange && state!.currency === i.currency &&
        typeof state!.permitted === "boolean" && typeof state!.halted === "boolean" && typeof state!.firstTrade === "boolean") {
        result.permitted = state!.permitted; result.halted = state!.halted; result.firstTrade = state!.firstTrade;
        result.venueOrderSupported = state!.venueOrderSupported;
        result.quantitySupported = state!.quantitySupported;
        result.priceUnitVerified = state!.priceUnitVerified;
        result.feeBound = state!.feeBound;
      } else result.reasons.push("Verified current account permission, halt and first-tradability evidence missing.");
      if (result.venueOrderSupported !== true) result.reasons.push("Exact venue/session/DAY limit-order support unknown or unsupported.");
      if (result.quantitySupported !== true) result.reasons.push("Exact whole-share quantity support unknown or unsupported.");
      if (result.priceUnitVerified !== true) result.reasons.push("Exact listing price unit unknown.");
      if (result.feeBound == null || !Number.isFinite(result.feeBound) || result.feeBound < 0) result.reasons.push("Conservative total fee bound unknown.");
      if (!result.permitted) result.reasons.push("Trading permission not verified.");
      if (result.halted) result.reasons.push("Trading halted or halt state unknown.");
      if (!result.firstTrade) result.reasons.push("First public tradability not verified; schedule/quotes alone are insufficient.");
      const ledger = row(await this.transport("GET", `/portfolio/${encodeURIComponent(this.accountId)}/ledger`));
      const cash = row(ledger[i.currency]);
      const settled = number(cash.settledcash), balance = number(cash.cashbalance);
      if (cash.currency !== i.currency || settled === null || balance === null) result.reasons.push("Currency-specific settled cash and cash balance required; no BASE/FX/borrowing fallback.");
      else {
        result.cashSettled = settled >= 0 && balance >= 0;
        result.availableCash = Math.max(0, Math.min(settled, balance));
        if (settled < 0 || balance < 0) result.reasons.push("Negative currency cash balance; borrowing is not authorised.");
      }
      const path = `/iserver/marketdata/snapshot?conids=${i.conid}&fields=31,84,86,6509`;
      // IBKR requires an initial snapshot pre-flight before data arrives. Retry
      // once only; partial data remains blocked instead of polling indefinitely.
      let snapshot = await this.transport("GET", path);
      const find = (v: unknown) => Array.isArray(v) ? v.map(row).filter(r => number(r.conid) === i.conid) : [];
      let quotes = find(snapshot);
      if (!quotes.length || (quotes.length === 1 && ["31", "84", "86", "6509", "_updated"].some(field => quotes[0][field] === undefined))) {
        snapshot = await this.transport("GET", path); quotes = find(snapshot);
      }
      const q = quotes.length === 1 ? quotes[0] : {};
      result.dataEntitled = typeof q["6509"] === "string" && /^R(?:[Pp])?B?$/.test(q["6509"]);
      if (!result.dataEntitled) result.reasons.push("Real-time market data entitlement missing; delayed/frozen/incomplete data blocked.");
      const updated = positive(q._updated), last = positive(q["31"]), bid = positive(q["84"]), ask = positive(q["86"]);
      if (updated && last && bid && ask && bid <= ask && now.getTime() >= updated && now.getTime() - updated <= this.maxQuoteAgeMs && result.dataEntitled) {
        result.quote = ask; result.quoteAt = new Date(updated).toISOString();
      } else result.reasons.push("Fresh real-time last/bid/ask and millisecond _updated required.");
      const calendar = clientPortalCalendar(await this.transport("GET", `/contract/trading-schedule?conid=${i.conid}&exchange=${encodeURIComponent(i.exchange)}`), now);
      Object.assign(result, { calendarKnown: calendar.calendarKnown, open: calendar.open, closedForDay: calendar.closedForDay });
      result.sessionOpensAt = calendar.sessionOpensAt;
      result.sessionClosesAt = calendar.sessionClosesAt;
      // Bound every result to the oldest source, including injected listing and
      // trading-state proof. Later auth/account requests cannot extend this lease.
      const horizon = Math.min(Date.parse(proof!.validUntil), Date.parse(state?.validUntil ?? ""), now.getTime() + 30000,
        Date.parse(result.quoteAt ?? "") + this.maxQuoteAgeMs);
      if (Number.isFinite(horizon)) result.validUntil = new Date(horizon).toISOString();
      result.reasons.push(...calendar.reasons);
    } catch {
      result.permitted = false; result.open = false;
      result.reasons.push("Read-only broker evidence request failed; preflight blocked.");
    }
    return result;
  }
}
