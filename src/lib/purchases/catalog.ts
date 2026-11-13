import type { Instrument, Trigger } from "./types";

const triggers: Trigger[] = ["schedule", "opening", "first-trade"];
// These identities demonstrate exact listing selection, not broker-verified contracts.
export const catalog: Instrument[] = [
  { id: "aapl-nasdaq", issuer: "Apple", symbol: "AAPL", conid: 265598, exchange: "NASDAQ", currency: "USD", shareClass: "Common", timezone: "America/New_York", evidence: "fixture", listing: "verified", supportedTriggers: triggers, reasons: [] },
  { id: "d05-sgx", issuer: "DBS Group", symbol: "D05", conid: 90000001, exchange: "SGX", currency: "SGD", shareClass: "Ordinary", timezone: "Asia/Singapore", evidence: "fixture", listing: "verified", supportedTriggers: ["schedule", "opening"], reasons: ["Contract ID is a local fixture, not a verified IBKR contract.", "First-trade detection is not supported for this fixture."] },
  { id: "vod-lse", issuer: "Vodafone", symbol: "VOD", conid: 90000002, exchange: "LSE", currency: "GBP", shareClass: "Ordinary", timezone: "Europe/London", evidence: "fixture", listing: "verified", supportedTriggers: ["schedule", "opening"], reasons: ["Contract ID and GBP price units are local fixtures, not a verified IBKR contract."] },
  { id: "new-listing", issuer: "Example New Listing", symbol: "DEMO", conid: 90000003, exchange: "NASDAQ", currency: "USD", shareClass: "Common", timezone: "America/New_York", evidence: "fixture", listing: "verified", supportedTriggers: triggers, reasons: ["Synthetic listing; first public trade is delayed until 11:00 exchange time."] },
  { id: "anthropic-unconfirmed", issuer: "Anthropic", symbol: null, conid: null, exchange: "Unconfirmed", currency: "USD", shareClass: "Unconfirmed", timezone: "America/New_York", evidence: "fixture", listing: "unconfirmed", supportedTriggers: [], reasons: ["No confirmed public listing or broker contract. Waiting for authoritative listing evidence."] },
];

export function resolveContract(candidates: Instrument[]): { instrument: Instrument | null; reasons: string[] } {
  if (candidates.length !== 1) return { instrument: null, reasons: [candidates.length ? "Ambiguous listing: select an exact exchange and share class." : "No verified listing found."] };
  const instrument = candidates[0];
  if (instrument.listing !== "verified" || !instrument.conid || !instrument.symbol) return { instrument: null, reasons: instrument.reasons };
  return { instrument, reasons: [] };
}

export function localTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")), weekday: get("weekday") };
}

export function fixtureMarket(instrument: Instrument, now: Date) {
  const local = localTime(now, instrument.timezone);
  const holidays: Record<string, string[]> = { NASDAQ: ["2026-01-01", "2026-07-03", "2026-12-25"], SGX: ["2026-01-01", "2026-12-25"], LSE: ["2026-01-01", "2026-12-25"] };
  const bounds = instrument.exchange === "SGX" ? [540, 1020] : instrument.exchange === "LSE" ? [480, 990] : [570, 960];
  const holiday = ["Sat", "Sun"].includes(local.weekday) || (holidays[instrument.exchange] ?? []).includes(local.date);
  const lunch = instrument.exchange === "SGX" && local.minute >= 720 && local.minute < 780;
  const open = !holiday && !lunch && local.minute >= bounds[0] && local.minute < bounds[1];
  return { open, holiday, closedForDay: holiday || local.minute >= bounds[1], firstTrade: open && (instrument.id !== "new-listing" || local.minute >= 660), halted: false, date: local.date };
}
