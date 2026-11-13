import test from "node:test";
import assert from "node:assert/strict";
import { ClientPortalReadonlyEvidence, clientPortalCalendar, resolveClientPortalContract } from "../../src/lib/purchases/client-portal-evidence";
import type { VerifiedListing, VerifiedTradingState } from "../../src/lib/purchases/client-portal-evidence";
import type { ClientPortalTransport } from "../../src/lib/purchases/broker";
import type { Instrument, Purchase } from "../../src/lib/purchases/types";

const now = new Date("2026-03-09T14:00:00Z");
const proof: VerifiedListing = { issuer: "Example Issuer", symbol: "EXA", conid: 123, exchange: "NYSE", currency: "USD", shareClass: "Class A", timezone: "America/New_York", source: "https://issuer.example/listing", observedAt: "2026-03-09T13:59:00Z", validUntil: "2026-03-09T15:00:00Z" };
const instrument: Instrument = { ...proof, id: "verified-example", evidence: "broker-verified", listing: "verified", supportedTriggers: ["schedule", "opening", "first-trade"], reasons: [] };
const purchase: Purchase = { instrumentSnapshot: instrument, accountMode: "paper", id: "p1", instrumentId: instrument.id, accountId: "DU123", trigger: "schedule", scheduledAt: now.toISOString(), timezone: proof.timezone, session: "regular", shares: 1, limitPrice: 110, maxSpend: 120, buffer: 10, expiresAt: "2026-03-09T15:00:00Z", createdAt: now.toISOString(), state: "armed", cancellationPolicy: "cancel-remainder-at-expiry-or-session-end", reasons: [], filledShares: 0, spent: 0, reserved: 0, receipts: [], executions: [] };
const trading: VerifiedTradingState = { ...proof, accountId: purchase.accountId, permitted: true, halted: false, firstTrade: true, venueOrderSupported: true, quantitySupported: true, priceUnitVerified: true, feeBound: 5 };
const epoch = (s: string) => Date.parse(s) / 1000;
const hours = (a: string, b: string) => ({ opening: epoch(a), closing: epoch(b) });
const schedule = { exchange_time_zone: "America/New_York", schedules: {
  "20260306": { liquid_hours: [hours("2026-03-06T14:30:00Z", "2026-03-06T21:00:00Z")] },
  "20260309": { liquid_hours: [hours("2026-03-09T13:30:00Z", "2026-03-09T20:00:00Z")] },
  "20260310": { liquid_hours: [hours("2026-03-10T13:30:00Z", "2026-03-10T20:00:00Z")] },
} };
const search = [{ conid: 123, symbol: "EXA", companyName: "EXAMPLE ISSUER", sections: [{ secType: "STK" }] }];
const detail = { conid: 123, ticker: "EXA", secType: "STK", listingExchange: "NYSE", exchange: "SMART", currency: "USD" };
const quote = [{ conid: 123, "31": "100", "84": "99", "86": "101", "6509": "RpB", _updated: now.getTime() }];
type Responses = Partial<Record<"search" | "info" | "ledger" | "snapshot" | "schedule", unknown>>;
function harness(overrides: Responses = {}, listing: VerifiedListing | null = proof, state: VerifiedTradingState | null = trading) {
  const calls: string[] = [];
  const responses = { search, info: detail, ledger: { USD: { currency: "USD", settledcash: 1000, cashbalance: 900 }, BASE: { currency: "BASE", settledcash: 999999, cashbalance: 999999 } }, snapshot: quote, schedule, ...overrides };
  const transport: ClientPortalTransport = async (method, path, body) => {
    assert.equal(method, "GET"); assert.equal(body, undefined); calls.push(path);
    if (path.startsWith("/iserver/secdef/search?")) return responses.search;
    if (path.startsWith("/iserver/secdef/info?")) return responses.info;
    if (path === "/portfolio/DU123/ledger") return responses.ledger;
    if (path === "/iserver/marketdata/snapshot?conids=123&fields=31,84,86,6509") return responses.snapshot;
    if (path === "/contract/trading-schedule?conid=123&exchange=NYSE") return responses.schedule;
    throw new Error("Unexpected path");
  };
  return { calls, transport, adapter: new ClientPortalReadonlyEvidence(transport, "DU123", { accountMode: "paper", listing: async () => listing, tradingState: async () => state }) };
}

test("maps real endpoint protocols to conservative preflight without routing authority", async () => {
  const h = harness(); const r = await h.adapter.preflight(purchase, instrument, now);
  assert.deepEqual(r.reasons, []); assert.equal(r.availableCash, 900); assert.equal(r.quote, 101);
  assert.equal(r.quoteAt, now.toISOString()); assert.equal(r.open, true); assert.equal(r.calendarKnown, true);
  assert.equal(r.permitted, true); assert.equal(r.halted, false); assert.equal(r.dataEntitled, true);
  assert.equal(h.adapter.executionAllowed(), false);
  assert.equal(h.calls[0], "/iserver/secdef/search?symbol=Example%20Issuer&name=true&secType=STK");
  assert.equal(h.calls[1], "/iserver/secdef/info?conid=123&sectype=STK&exchange=NYSE");
  assert.equal(h.calls.length, 5);
});

test("generic permission alone leaves venue, quantity, price-unit and fee evidence explicitly unknown", async () => {
  const h = harness({}, proof, { ...trading, venueOrderSupported: undefined, quantitySupported: undefined, priceUnitVerified: undefined, feeBound: undefined });
  const r = await h.adapter.preflight(purchase, instrument, now);
  assert.equal(r.permitted, true);
  assert.equal(r.venueOrderSupported, undefined); assert.equal(r.feeBound, undefined);
  for (const unknown of [/venue/, /quantity/, /price unit/, /fee bound/]) assert.match(r.reasons.join(" "), unknown);
});

test("resolves multiple listings only with exact external issuer/share-class mapping", async () => {
  const h = harness({ search: [...search, { conid: 456, symbol: "EXB", sections: [{ secType: "STK" }] }] });
  assert.equal((await resolveClientPortalContract(h.transport, proof.issuer, null, now)).status, "ambiguous");
  const r = await resolveClientPortalContract(h.transport, proof.issuer, proof, now);
  assert.equal(r.status, "resolved"); if (r.status === "resolved") assert.equal(r.instrument.shareClass, "Class A");
  for (const changed of [{ conid: 456 }, { currency: "SGD" }, { exchange: "SGX" }, { symbol: "EXB" }]) {
    assert.equal((await resolveClientPortalContract(h.transport, proof.issuer, { ...proof, ...changed }, now)).status, "blocked");
  }
});

test("unconfirmed issuer never becomes a guessed ticker; malformed and duplicate evidence block", async () => {
  const missing = harness({ search: [] });
  assert.equal((await resolveClientPortalContract(missing.transport, "Anthropic", null, now)).status, "waiting-for-listing");
  for (const responses of [{ search: {} }, { search: [...search, ...search] }, { info: {} }, { info: [detail, detail] }, { info: { ...detail, secType: "CFD" } }]) {
    assert.equal((await resolveClientPortalContract(harness(responses).transport, proof.issuer, proof, now)).status, "blocked");
  }
  assert.equal((await resolveClientPortalContract(harness().transport, "Other issuer", proof, now)).status, "blocked");
  assert.equal((await resolveClientPortalContract(harness().transport, proof.issuer, { ...proof, validUntil: now.toISOString() }, now)).status, "blocked");
});

test("fixtures, mismatched accounts, missing/stale listing evidence block before broker requests", async () => {
  for (const h of [harness({}, null), harness({}, { ...proof, shareClass: "Class B" }), harness({}, { ...proof, observedAt: "2026-03-09T14:01:00Z" })]) {
    const r = await h.adapter.preflight(purchase, instrument, now);
    assert.equal(r.permitted, false); assert.equal(h.calls.length, 0); assert.ok(r.reasons.length);
  }
  const h = harness();
  await h.adapter.preflight(purchase, { ...instrument, evidence: "fixture" }, now);
  await h.adapter.preflight({ ...purchase, accountId: "Other" }, instrument, now);
  assert.equal(h.calls.length, 0);
});

test("permission, halts and first trade cannot be inferred from contracts, quotes or calendar", async () => {
  for (const state of [null, { ...trading, accountId: "Other" }, { ...trading, validUntil: now.toISOString() }]) {
    const r = await harness({}, proof, state).adapter.preflight({ ...purchase, trigger: "first-trade" }, instrument, now);
    assert.equal(r.permitted, false); assert.equal(r.halted, true); assert.equal(r.firstTrade, false);
    assert.ok(r.reasons.some(s => s.includes("tradability")));
  }
  const r = await harness({}, proof, { ...trading, permitted: false, halted: true, firstTrade: false }).adapter.preflight(purchase, instrument, now);
  assert.equal(r.permitted, false); assert.equal(r.halted, true);
});

test("cash uses minimum of currency settled and cash balance; no BASE, FX or borrowing fallback", async () => {
  for (const cash of [{ currency: "USD", settledcash: -1, cashbalance: 900 }, { currency: "USD", settledcash: 1000, cashbalance: -10 }]) {
    const r = await harness({ ledger: { USD: cash } }).adapter.preflight(purchase, instrument, now);
    assert.equal(r.availableCash, 0); assert.ok(r.reasons.some(s => s.includes("Negative")));
  }
  for (const ledger of [{ BASE: { settledcash: 999999, cashbalance: 999999 } }, { USD: { currency: "SGD", settledcash: 10, cashbalance: 10 } }, { USD: { currency: "USD", settledcash: "", cashbalance: 10 } }, null]) {
    const r = await harness({ ledger }).adapter.preflight(purchase, instrument, now);
    assert.equal(r.availableCash, 0); assert.ok(r.reasons.length);
  }
});

test("missing, delayed, frozen, unsubscribed and malformed entitlement never qualify", async () => {
  for (const entitlement of [undefined, "D", "Z", "Y", "N", "i", "v", "", "garbage", "Rgarbage"]) {
    const r = await harness({ snapshot: [{ ...quote[0], "6509": entitlement }] }).adapter.preflight(purchase, instrument, now);
    assert.equal(r.dataEntitled, false); assert.equal(r.quote, null);
  }
});

test("stale/future/seconds timestamps, bad prices and duplicate snapshots block quotes", async () => {
  for (const patch of [{ _updated: now.getTime() - 30001 }, { _updated: now.getTime() + 1 }, { _updated: now.getTime() / 1000 }, { _updated: undefined }, { "31": "C100" }, { "84": "102" }, { "86": -1 }, { "86": "NaN" }]) {
    const r = await harness({ snapshot: [{ ...quote[0], ...patch }] }).adapter.preflight(purchase, instrument, now);
    assert.equal(r.quote, null); assert.ok(r.reasons.length);
  }
  assert.equal((await harness({ snapshot: [...quote, ...quote] }).adapter.preflight(purchase, instrument, now)).quote, null);
});

test("initial empty snapshot gets only one bounded retry", async () => {
  const h = harness({ snapshot: [{ conid: 123 }] });
  const r = await h.adapter.preflight(purchase, instrument, now);
  assert.equal(r.quote, null); assert.equal(h.calls.filter(s => s.includes("snapshot")).length, 2);
});

test("snapshot warmup can return an empty array and legacy contract info array is supported", async () => {
  const h = harness({ info: [detail] });
  let snapshots = 0;
  const transport: ClientPortalTransport = async (method, path, body) => {
    if (path.includes("snapshot") && snapshots++ === 0) return [];
    return h.transport(method, path, body);
  };
  const adapter = new ClientPortalReadonlyEvidence(transport, "DU123", { accountMode: "paper", listing: async () => proof, tradingState: async () => trading });
  const r = await adapter.preflight(purchase, instrument, now);
  assert.equal(snapshots, 2); assert.equal(r.quote, 101); assert.deepEqual(r.reasons, []);
  assert.equal(r.cashSettled, true); assert.equal(r.quoteCurrency, "USD"); assert.equal(r.accountMode, "paper");
});

test("epoch schedule respects DST, holiday omission, exclusive close, lunch and horizon", () => {
  assert.equal(clientPortalCalendar(schedule, new Date("2026-03-06T14:00:00Z")).open, false);
  assert.equal(clientPortalCalendar(schedule, now).open, true); // Same local 10:00 after DST.
  const weekend = clientPortalCalendar(schedule, new Date("2026-03-08T16:00:00Z"));
  assert.equal(weekend.calendarKnown, true); assert.equal(weekend.closedForDay, true);
  assert.equal(clientPortalCalendar(schedule, new Date("2026-03-09T20:00:00Z")).closedForDay, true);
  assert.equal(clientPortalCalendar(schedule, new Date("2026-04-01T14:00:00Z")).calendarKnown, false);
  const asia = { exchange_time_zone: "Asia/Singapore", schedules: {
    "20260309": { liquid_hours: [hours("2026-03-09T01:00:00Z", "2026-03-09T04:00:00Z"), hours("2026-03-09T05:00:00Z", "2026-03-09T09:00:00Z")] },
    "20260311": { liquid_hours: [hours("2026-03-11T01:00:00Z", "2026-03-11T09:00:00Z")] },
  } };
  const lunch = clientPortalCalendar(asia, new Date("2026-03-09T04:30:00Z"));
  assert.equal(lunch.calendarKnown, true); assert.equal(lunch.open, false); assert.equal(lunch.closedForDay, false);
  assert.equal(clientPortalCalendar(asia, new Date("2026-03-09T05:00:00Z")).open, true);
  assert.equal(clientPortalCalendar(asia, new Date("2026-03-10T04:00:00Z")).closedForDay, true); // Omitted holiday.
});

test("malformed schedules and transport errors fail closed without raw error disclosure", async () => {
  for (const value of [null, {}, { ...schedule, exchange_time_zone: "bad/zone" }, { ...schedule, schedules: { "20260309": { liquid_hours: [{ opening: 10, closing: 1 }] } } }, { ...schedule, schedules: { "20260309": { liquid_hours: [{ opening: now.getTime(), closing: now.getTime() + 100 }] } } }]) {
    assert.equal(clientPortalCalendar(value, now).calendarKnown, false);
  }
  const transport: ClientPortalTransport = async () => { throw new Error("private transport secret"); };
  const r = await resolveClientPortalContract(transport, proof.issuer, proof, now);
  assert.equal(r.status, "blocked"); assert.ok(!JSON.stringify(r).includes("private transport secret"));
});
