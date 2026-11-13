import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PurchaseStore } from "../../src/lib/purchases/store";
import { PurchaseService, preview, validateInput } from "../../src/lib/purchases/service";
import { MockBroker } from "../../src/lib/purchases/broker";
import type { MockScenario } from "../../src/lib/purchases/broker";
import { catalog, fixtureMarket, resolveContract } from "../../src/lib/purchases/catalog";
import type { MandateInput } from "../../src/lib/purchases/types";
import { guardMutation } from "../../src/lib/purchases/server";

const input: MandateInput = { instrumentId: "aapl-nasdaq", accountId: "mock-cash", trigger: "schedule", scheduledAt: "2026-06-15T13:30:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, maxSpend: 225, buffer: 5, expiresAt: "2026-06-15T20:00:00Z" };
async function setup(t: { after(fn: () => Promise<void>): void }, scenario: MockScenario = {}) {
  const root = path.join(os.homedir(), ".local/state/rucksack/scratch/remora-purchase-tests");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "case-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PurchaseStore(path.join(dir, "purchases.json"));
  let now = new Date("2026-06-15T14:00:00Z");
  const service = new PurchaseService(store, tx => new MockBroker(tx, scenario), () => now);
  const arm = async (changes: Partial<MandateInput> = {}) => {
    const p = await service.create({ ...input, ...changes });
    return service.action(p.id, "arm");
  };
  return { store, service, arm, time: (date: string) => { now = new Date(date); } };
}
test("durable schedule lifecycle: reserve, unattended fill, restart and no duplicate intent", async t => {
  const { store, service, arm } = await setup(t);
  const p = await arm();
  assert.equal(p.state, "armed"); assert.equal(p.reserved, 225);
  const [filled] = await service.tick();
  assert.equal(filled.state, "filled"); assert.equal(filled.spent, 200); assert.equal(filled.reserved, 0);
  const restarted = new PurchaseService(new PurchaseStore(store.filename));
  await restarted.tick();
  const db = await store.load();
  assert.equal(Object.keys(db.mockOrders).length, 1);
  assert.equal(db.purchases[0].intentId, filled.intentId);
  assert.equal(db.purchases[0].receipts.filter(r => r.kind === "intent-created").length, 1);
});
test("unknown submit response reconciles accepted order after restart, never retries", async t => {
  const { store, service, arm } = await setup(t, { outcome: "unknown" });
  await arm();
  assert.equal((await service.tick())[0].state, "reconciliation-required");
  const restarted = new PurchaseService(store, tx => new MockBroker(tx), () => new Date("2026-06-15T14:01:00Z"));
  assert.equal((await restarted.tick())[0].state, "filled");
  assert.equal(Object.keys((await store.load()).mockOrders).length, 1);
});
test("unknown without broker evidence retains reservation and cannot rearm", async t => {
  const { store, service, arm } = await setup(t, { outcome: "unknown" });
  const p = await arm(); await service.tick();
  await store.transaction(async tx => { tx.data.mockOrders = {}; });
  assert.equal((await service.tick())[0].state, "reconciliation-required");
  assert.equal((await store.load()).purchases[0].reserved, 225);
  await assert.rejects(service.action(p.id, "arm"), /cannot be rearmed/);
  await service.tick(); assert.equal(Object.keys((await store.load()).mockOrders).length, 0);
});
test("verified fixture new listing waits for delayed first public trade independently of IPO allocation", async t => {
  const { service, arm, time } = await setup(t);
  const p = await arm({ instrumentId: "new-listing", trigger: "first-trade" });
  assert.equal(p.state, "armed");
  assert.equal((await service.tick())[0].state, "waiting-for-opening");
  time("2026-06-15T15:00:00Z");
  assert.equal((await service.tick())[0].state, "filled");
  assert.match((await service.dashboard(true)).notices.join(" "), /IPO subscription is not implemented/);
});
test("ordinary opening waits for regular session, never promises auction price", async t => {
  const { service, arm, time } = await setup(t);
  time("2026-06-15T13:00:00Z");
  await arm({ trigger: "opening", scheduledAt: "2026-06-15T12:00:00Z" });
  assert.equal((await service.tick())[0].state, "waiting-for-opening");
  time("2026-06-15T13:30:00Z"); assert.equal((await service.tick())[0].state, "filled");
});
test("partial fill plus halt confirms cancellation and releases only remaining reservation", async t => {
  const scenario: MockScenario = { outcome: "partial" };
  const { service, arm } = await setup(t, scenario);
  const p = await arm();
  assert.equal((await service.tick())[0].state, "partially-filled");
  scenario.preflight = { halted: true };
  const [cancelled] = await service.tick();
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.filledShares, 1); assert.equal(cancelled.spent, 100); assert.equal(cancelled.reserved, 0);
  await assert.rejects(service.action(p.id, "arm"));
});
test("revocation survives unknown cancellation, then confirmed cancellation releases only unused cash", async t => {
  const { store, service, arm } = await setup(t, { outcome: "partial" });
  const p = await arm(); await service.tick();
  const pendingService = new PurchaseService(store, tx => {
    const broker = new MockBroker(tx);
    broker.cancel = async () => null;
    return broker;
  }, () => new Date("2026-06-15T14:01:00Z"));
  const pending = await pendingService.action(p.id, "revoke");
  assert.equal(pending.state, "cancellation-pending"); assert.equal(pending.revoked, true); assert.equal(pending.reserved, 125);
  assert.equal((await pendingService.tick())[0].state, "cancellation-pending");
  const [cancelled] = await service.tick();
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.spent, 100); assert.equal(cancelled.reserved, 0);
});
test("out-of-bound broker price/fill evidence cannot free risk reservations", async t => {
  const { store, service, arm } = await setup(t, { outcome: "unknown" });
  await arm(); const [unknown] = await service.tick();
  let quantity = 3, price = 100;
  const badService = new PurchaseService(store, tx => {
    const broker = new MockBroker(tx);
    broker.reconcile = async () => ({ intentId: unknown.intentId!, orderId: `mock-${unknown.intentId}`, state: "filled", filledShares: quantity, spent: quantity * price, feesKnown: true, executions: [{ id: "bad-execution", quantity, price, fee: 0, currency: "USD" }] });
    return broker;
  }, () => new Date("2026-06-15T14:00:00Z"));
  const [badFill] = await badService.tick();
  assert.equal(badFill.state, "reconciliation-required"); assert.equal(badFill.reserved, 225); assert.equal(badFill.spent, 0);
  quantity = 1; price = 120; // Above one share limit plus the complete buffer.
  const [badPrice] = await badService.tick();
  assert.equal(badPrice.state, "reconciliation-required"); assert.equal(badPrice.reserved, 225);
});
test("draft expiry and budget-incomplete mandates never self-arm", async t => {
  const { service, time, store } = await setup(t);
  await service.create(input);
  const incomplete = await service.create({ ...input, maxSpend: 200 });
  assert.equal((await service.action(incomplete.id, "arm")).state, "blocked");
  await service.tick(); assert.equal(Object.keys((await store.load()).mockOrders).length, 0);
  time("2026-06-15T20:00:00Z");
  assert.deepEqual((await service.tick()).map(p => p.state), ["expired", "expired"]);
});
test("stale quote, permissions, auth, cash/currency and unavailable calendar block submission", async t => {
  const failures = [{ quoteAt: "2026-06-15T13:00:00Z" }, { authenticated: false }, { sessionReady: false }, { permitted: false }, { dataEntitled: false }, { currency: "SGD" }, { quoteCurrency: "SGD" }, { cashSettled: false }, { availableCash: 1 }, { calendarKnown: false }, { quote: 111 }];
  for (const preflight of failures) {
    const { service, arm, store } = await setup(t, { preflight });
    await arm();
    const [blocked] = await service.tick();
    assert.equal(blocked.state, "blocked", JSON.stringify(preflight));
    assert.equal(blocked.intentId, undefined);
    assert.equal(Object.keys((await store.load()).mockOrders).length, 0);
  }
});
test("aggregate risk reservations serialize competing mandates", async t => {
  const { service, arm } = await setup(t);
  const first = await arm({ shares: 500, maxSpend: 55005 });
  const second = await arm({ shares: 500, maxSpend: 55005 });
  assert.equal(first.state, "armed"); assert.equal(second.state, "blocked"); assert.equal(second.reserved, 0);
  await service.action(first.id, "revoke");
  assert.equal((await service.action(second.id, "arm")).state, "armed");
});
test("expiry, revocation and kill switch prevent new routing without per-order approval", async t => {
  const { service, arm, time, store } = await setup(t);
  const p = await arm(); await service.action(p.id, "revoke");
  assert.equal((await service.tick())[0].state, "revoked");
  await arm(); time("2026-06-15T20:00:00Z");
  assert.equal((await service.tick())[1].state, "expired");
  time("2026-06-15T14:00:00Z"); const third = await arm();
  await service.kill(true); await service.kill(false);
  assert.equal((await service.tick())[2].state, "revoked");
  await assert.rejects(service.action(third.id, "arm"));
  assert.equal(Object.keys((await store.load()).mockOrders).length, 0);
});
test("holiday blocks before arming, missed sessions expire and DST uses exchange timezone", async t => {
  const { service, arm, time } = await setup(t);
  time("2026-07-03T14:00:00Z");
  await arm({ scheduledAt: "2026-07-03T13:30:00Z", expiresAt: "2026-07-04T20:00:00Z" });
  assert.equal((await service.tick())[0].state, "blocked");
  assert.match((await service.tick())[0].reasons.join(" "), /selected exchange session is closed/);
  time("2026-07-04T20:00:00Z");
  assert.equal((await service.tick())[0].state, "expired");
  const aapl = catalog[0];
  assert.equal(fixtureMarket(aapl, new Date("2026-03-06T14:30:00Z")).open, true);
  assert.equal(fixtureMarket(aapl, new Date("2026-03-09T13:30:00Z")).open, true);
  assert.equal(fixtureMarket(aapl, new Date("2026-03-09T13:29:00Z")).open, false);
  time("2026-06-15T14:00:00Z"); await arm(); time("2026-06-16T14:00:00Z");
  assert.equal((await service.tick())[1].state, "expired");
});
test("preview exposes ended sessions and a usable later trading-day choice before arming", () => {
  const sgx = { ...input, instrumentId: "d05-sgx", scheduledAt: "2026-06-15T01:00:00Z", expiresAt: "2026-06-15T08:30:00Z" };
  assert.equal(preview(sgx, new Date("2026-06-15T00:00:00Z")).supported, true);
  assert.match(preview({ ...sgx, scheduledAt: "2026-06-15T10:00:00Z", expiresAt: "2026-06-15T11:00:00Z" }, new Date("2026-06-15T00:00:00Z")).reasons.join(" "), /session is closed/);
  assert.match(preview(sgx, new Date("2026-06-15T10:00:00Z")).reasons.join(" "), /already ended/);
  assert.equal(preview({ ...sgx, scheduledAt: "2026-06-16T01:00:00Z", expiresAt: "2026-06-16T08:30:00Z" }, new Date("2026-06-15T10:00:00Z")).supported, true);
});
test("unconfirmed Anthropic, ambiguous listing, unsupported venues and invalid bounds never resolve silently", async t => {
  const { arm } = await setup(t);
  const waiting = await arm({ instrumentId: "anthropic-unconfirmed" });
  assert.equal(waiting.state, "waiting-for-listing"); assert.equal(waiting.reserved, 0);
  assert.equal(resolveContract([catalog[0], catalog[1]]).instrument, null);
  assert.equal(resolveContract([catalog[4]]).instrument, null);
  assert.match(preview({ ...input, instrumentId: "d05-sgx", trigger: "first-trade" }, new Date(input.scheduledAt)).reasons.join(" "), /does not support the selected trigger/);
  for (const changes of [{ shares: 1.2 }, { limitPrice: Infinity }, { trigger: "market" }, { session: "extended" }, { timezone: "Bad/Zone" }, { expiresAt: input.scheduledAt }, { scheduledAt: "2026-06-15T13:30" }]) assert.throws(() => validateInput({ ...input, ...changes }));
  assert.equal(preview({ ...input, maxSpend: 200 }, new Date(input.scheduledAt)).supported, false);
});
test("store lock fails closed and data cannot be stored under the project", async t => {
  assert.throws(() => new PurchaseStore(path.join(process.cwd(), "public/purchases.json")));
  const { store } = await setup(t);
  await store.transaction(async () => { await assert.rejects(store.transaction(async () => true), /locked/); });
});
test("mutation gate requires mock environment, private store and local same origin", () => {
  const previousMode = process.env.REMORA_PURCHASE_MODE, previousStore = process.env.REMORA_PURCHASE_STORE;
  const request = (url: string, origin?: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: "{}" });
  try {
    delete process.env.REMORA_PURCHASE_MODE;
    assert.throws(() => guardMutation(request("http://localhost:3000/api/purchases")), /held/);
    process.env.REMORA_PURCHASE_MODE = "live"; process.env.REMORA_PURCHASE_STORE = "/private/purchases.json";
    assert.throws(() => guardMutation(request("http://localhost:3000/api/purchases")), /held/);
    process.env.REMORA_PURCHASE_MODE = "mock";
    guardMutation(request("http://localhost:3000/api/purchases"));
    assert.throws(() => guardMutation(request("http://public.example/api/purchases")), /local-only/);
    assert.throws(() => guardMutation(request("http://localhost:3000/api/purchases", "https://evil.example")), /Cross-origin/);
  } finally {
    if (previousMode === undefined) delete process.env.REMORA_PURCHASE_MODE; else process.env.REMORA_PURCHASE_MODE = previousMode;
    if (previousStore === undefined) delete process.env.REMORA_PURCHASE_STORE; else process.env.REMORA_PURCHASE_STORE = previousStore;
  }
});
