import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PurchaseStore, PurchaseStoreBusyError } from "../../src/lib/purchases/store";
import { PurchaseService } from "../../src/lib/purchases/service";
import { MockBroker } from "../../src/lib/purchases/broker";
import type { BrokerOrder, MockScenario } from "../../src/lib/purchases/broker";
import type { MandateInput } from "../../src/lib/purchases/types";
import { workerTick } from "../../scripts/purchase-worker";

const input: MandateInput = { instrumentId: "aapl-nasdaq", accountId: "mock-cash", trigger: "schedule", scheduledAt: "2026-06-15T13:30:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, maxSpend: 225, buffer: 5, expiresAt: "2026-06-15T20:00:00Z" };
async function setup(t: { after(fn: () => Promise<void>): void }, scenario: MockScenario = {}) {
  const root = path.join(os.homedir(), ".local/state/rucksack/scratch/remora-purchase-tests");
  await mkdir(root, { recursive: true }); const dir = await mkdtemp(path.join(root, "repair-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PurchaseStore(path.join(dir, "db.json"));
  let now = new Date("2026-06-15T14:00:00Z");
  const service = new PurchaseService(store, tx => new MockBroker(tx, scenario), () => now);
  const arm = async (changes: Partial<MandateInput> = {}) => service.action((await service.create({ ...input, ...changes })).id, "arm");
  return { store, service, arm, time: (v: string) => { now = new Date(v); } };
}
test("complete durable schema rejects valid-JSON corruption on read and mutation without replacing evidence", async t => {
  const { store, service, arm } = await setup(t);
  await arm(); await service.tick();
  const original = await readFile(store.filename, "utf8");
  type Damaged = { [key: string]: unknown; purchases: { [key: string]: unknown; receipts: { evidence: unknown }[] }[]; mockOrders: Record<string, { [key: string]: unknown; executions?: unknown[] }> };
  const corruptions: ((db: Damaged) => void)[] = [
    db => { delete db.purchases[0].spent; }, db => { db.purchases[0].spent = null; },
    db => { db.purchases[0].spent = -1; }, db => { db.purchases[0].spent = 199.99; }, db => { db.purchases[0].reserved = null; },
    db => { db.purchases[0].state = "invented"; }, db => { delete db.purchases[0].intentId; },
    db => { db.purchases.push({ ...db.purchases[0], id: "second" }); },
    db => { db.purchases[0].executions = undefined; }, db => { db.purchases[0].filledShares = 1; },
    db => { db.purchases[0].receipts[0].evidence = "live"; }, db => { db.killSwitch = null; },
    db => { db.lastCheckAt = "bad-date"; }, db => { (db as Record<string, unknown>).mockOrders = []; },
    db => { Object.values(db.mockOrders)[0].spent = null; },
    db => { Object.values(db.mockOrders)[0].executions = undefined; },
    db => { Object.values(db.mockOrders)[0].executions!.push(Object.values(db.mockOrders)[0].executions![0]); },
    db => { Object.values(db.mockOrders)[0].intentId = "different"; },
    db => { Object.values(db.mockOrders)[0].state = "invented"; },
  ];
  for (const mutate of corruptions) {
    const db = JSON.parse(original); mutate(db); const damaged = JSON.stringify(db);
    await writeFile(store.filename, damaged);
    await assert.rejects(store.load(), /recovery required/);
    await assert.rejects(service.tick(), /recovery required/);
    assert.equal(await readFile(store.filename, "utf8"), damaged);
  }
  await writeFile(store.filename, original);
  await assert.rejects(store.transaction(async tx => { tx.data.purchases[0].reserved = NaN; }), /recovery required/);
  assert.equal(await readFile(store.filename, "utf8"), original);
});

test("per-fill prices and separate fees cannot be hidden by average or buffer; exact duplicate execution is counted once", async t => {
  for (const prices of [[112], [100, 120]]) {
    const { store, service, arm } = await setup(t, { outcome: "unknown" });
    await arm(); const [p] = await service.tick();
    const unsafe = new PurchaseService(store, tx => {
      const b = new MockBroker(tx);
      b.reconcile = async () => ({ intentId: p.intentId!, orderId: `mock-${p.intentId}`, state: "partially-filled", filledShares: prices.length, spent: prices.reduce((n, price) => n + price, 0), feesKnown: true, executions: prices.map((price, n) => ({ id: `fill-${n}`, quantity: 1, price, fee: 0, currency: "USD" })) });
      return b;
    }, () => new Date("2026-06-15T14:00:00Z"));
    const [result] = await unsafe.tick();
    assert.equal(result.state, "reconciliation-required"); assert.equal(result.reserved, 225); assert.equal(result.spent, 0);
  }
  const { store, service, arm } = await setup(t, { outcome: "unknown" });
  await arm(); const [p] = await service.tick();
  const execution = { id: "separate-fee", quantity: 1, price: 110, fee: 2, currency: "USD" };
  let order: BrokerOrder = { intentId: p.intentId!, orderId: `mock-${p.intentId}`, state: "partially-filled", filledShares: 1, spent: 112, feesKnown: true, executions: [execution, execution] };
  const checked = new PurchaseService(store, tx => { const b = new MockBroker(tx); b.reconcile = async () => order; return b; }, () => new Date("2026-06-15T14:00:00Z"));
  const [partial] = await checked.tick();
  assert.equal(partial.spent, 112); assert.equal(partial.executions.length, 1); assert.equal(partial.filledShares, 1);
  order = { ...order, state: "filled", filledShares: 2, spent: 227, executions: [execution, { id: "fill-2", quantity: 1, price: 110, fee: 5, currency: "USD" }] };
  const [overBudget] = await checked.tick(); assert.equal(overBudget.state, "reconciliation-required"); assert.equal(overBudget.reserved, 113);
});

test("missing commission keeps the full reservation until exact per-execution costs are confirmed", async t => {
  const { store, service, arm } = await setup(t, { outcome: "unknown" });
  await arm(); const [p] = await service.tick(); let known = false;
  const checked = new PurchaseService(store, tx => {
    const b = new MockBroker(tx);
    b.reconcile = async () => ({ intentId: p.intentId!, orderId: `mock-${p.intentId}`, state: "filled", filledShares: 2, spent: known ? 201.01 : 200, feesKnown: known, executions: [{ id: "execution-with-commission", quantity: 2, price: 100, fee: known ? 1.01 : null, currency: "USD" }] });
    return b;
  }, () => new Date("2026-06-15T14:00:00Z"));
  const [missing] = await checked.tick(); assert.equal(missing.state, "reconciliation-required"); assert.equal(missing.reserved, 225); assert.equal(missing.spent, 0);
  known = true; const [confirmed] = await checked.tick(); assert.equal(confirmed.state, "filled"); assert.equal(confirmed.spent, 201.01); assert.equal(confirmed.reserved, 0);
});

test("expiry of unknown submission discovers broker ID before automatic cancellation across restart", async t => {
  const { store, service, arm } = await setup(t, { outcome: "unknown" });
  await arm(); await service.tick(); let reconciles = 0, cancels = 0;
  const restarted = new PurchaseService(store, tx => {
    const b = new MockBroker(tx); const reconcile = b.reconcile.bind(b), cancel = b.cancel.bind(b);
    b.reconcile = async p => { reconciles++; assert.ok(p.stopRequested); return reconcile(p); };
    b.cancel = async p => { cancels++; return p.brokerOrderId ? cancel(p) : null; };
    return b;
  }, () => new Date("2026-06-15T20:01:00Z"));
  const [result] = await restarted.tick(); assert.equal(result.state, "filled"); assert.equal(result.spent, 200); assert.ok(reconciles > 0); assert.equal(cancels, 0);
  assert.equal(Object.keys((await store.load()).mockOrders).length, 1);
});

test("expired unknown partial acceptance automatically reconciles identity then cancels the remainder", async t => {
  const { store, service, arm } = await setup(t);
  await arm();
  const lost = new PurchaseService(store, tx => {
    const b = new MockBroker(tx, { outcome: "partial" }); const submit = b.submit.bind(b);
    b.submit = async p => { await submit(p); throw new Error("lost response"); }; return b;
  }, () => new Date("2026-06-15T14:00:00Z"));
  assert.equal((await lost.tick())[0].brokerOrderId, undefined);
  let cancels = 0;
  const restarted = new PurchaseService(store, tx => {
    const b = new MockBroker(tx), cancel = b.cancel.bind(b);
    b.cancel = async p => { assert.ok(p.brokerOrderId); assert.equal(p.filledShares, 1); cancels++; return cancel(p); }; return b;
  }, () => new Date("2026-06-15T20:01:00Z"));
  const [result] = await restarted.tick(); assert.equal(result.state, "cancelled"); assert.equal(result.spent, 100); assert.equal(result.reserved, 0); assert.equal(cancels, 1);
  await service.tick(); assert.equal(Object.keys((await store.load()).mockOrders).length, 1);
});

test("stop intent survives working responses and cleared halt, without manual refresh", async t => {
  const { store, service, arm } = await setup(t, { outcome: "partial" }); await arm(); await service.tick();
  let cancelCalls = 0;
  const stopping = new PurchaseService(store, tx => {
    const b = new MockBroker(tx); b.preflight = async () => { throw new Error("stopped intent must not depend on preflight"); };
    const cancel = b.cancel.bind(b);
    b.cancel = async p => { cancelCalls++; assert.ok(p.brokerOrderId); assert.equal((await store.load()).purchases[0].stopRequested, "cancelled"); return cancelCalls === 1 ? null : cancel(p); };
    return b;
  }, () => new Date("2026-06-15T14:01:00Z"));
  const p = (await store.load()).purchases[0];
  assert.equal((await stopping.action(p.id, "cancel")).state, "cancellation-pending");
  assert.equal((await stopping.tick())[0].state, "cancelled"); assert.equal(cancelCalls, 2);
});

test("all trigger variants wait for listing tradability, not just exchange opening", async t => {
  for (const trigger of ["schedule", "opening", "first-trade"] as const) {
    const { service, arm, time, store } = await setup(t); await arm({ instrumentId: "new-listing", trigger });
    assert.equal((await service.tick())[0].state, "waiting-for-opening"); assert.equal(Object.keys((await store.load()).mockOrders).length, 0);
    time("2026-06-15T15:00:00Z"); assert.equal((await service.tick())[0].state, "filled");
  }
});

test("SGX and LSE fill in listing currency; aggregate controls are per-currency and never borrow USD or FX", async t => {
  const { service, arm, time, store } = await setup(t);
  time("2026-06-15T01:30:00Z");
  await arm({ instrumentId: "d05-sgx", scheduledAt: "2026-06-15T01:00:00Z" });
  const [sgx] = await service.tick(); assert.equal(sgx.state, "filled"); assert.equal(sgx.executions[0].currency, "SGD");
  time("2026-06-15T08:00:00Z"); await arm({ instrumentId: "vod-lse", scheduledAt: "2026-06-15T07:00:00Z" });
  assert.equal((await service.tick())[1].executions[0].currency, "GBP");
  time("2026-06-15T14:00:00Z");
  await arm({ shares: 600, maxSpend: 66005 });
  const blocked = await arm({ shares: 600, maxSpend: 66005 }); assert.equal(blocked.state, "blocked");
  assert.equal((await service.tick())[2].state, "filled");
  const nextSGX = { instrumentId: "d05-sgx", scheduledAt: "2026-06-16T01:00:00Z", expiresAt: "2026-06-16T08:30:00Z" };
  const tooMuchSGD = await arm({ ...nextSGX, shares: 500, maxSpend: 55005 });
  assert.equal(tooMuchSGD.state, "blocked"); assert.match(tooMuchSGD.reasons.join(" "), /cash/);
  const sgdReserve = await arm({ ...nextSGX, shares: 300, maxSpend: 33005 });
  assert.equal(sgdReserve.state, "armed"); // Existing USD spend cannot consume SGD cash.
  const sgdAggregate = await arm({ ...nextSGX, shares: 300, maxSpend: 33005 });
  assert.equal(sgdAggregate.state, "blocked"); assert.match(sgdAggregate.reasons.join(" "), /reserved by other mandates/);
  assert.equal((await arm({ instrumentId: "vod-lse", shares: 150, maxSpend: 16505 })).state, "armed");
  const db = await store.load(); assert.equal(Object.keys(db.mockOrders).length, 3);
});

test("two concurrent transactions exclude one writer and worker retries busy without stealing even old locks", async t => {
  const { store, service } = await setup(t); let release!: () => void, acquired!: () => void;
  const held = new Promise<void>(resolve => { acquired = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const first = store.transaction(async tx => { acquired(); await wait; tx.data.killSwitch = true; });
  await held;
  try {
    await assert.rejects(new PurchaseStore(store.filename).transaction(async () => true), PurchaseStoreBusyError);
    assert.equal(await workerTick(service), false);
    await utimes(`${store.filename}.lock`, new Date(0), new Date(0));
    assert.equal(await workerTick(service), false); assert.ok(await stat(`${store.filename}.lock`));
  } finally { release(); }
  await first;
  assert.equal(await workerTick(service), true); assert.equal((await store.load()).killSwitch, true);
  await assert.rejects(workerTick({ tick: async () => { throw new Error("corrupt"); } }), /corrupt/);
});

test("actual worker process survives API-style lock contention then completes heartbeat", { timeout: 10000 }, async t => {
  const { store } = await setup(t);
  const script = path.resolve(__dirname, "../../scripts/purchase-worker.js");
  let child: ReturnType<typeof spawn> | undefined;
  await store.transaction(async () => {
    child = spawn(process.execPath, [script, "--once"], { env: { ...process.env, REMORA_PURCHASE_MODE: "mock", REMORA_PURCHASE_STORE: store.filename }, stdio: ["ignore", "pipe", "pipe"] });
    t.after(async () => { if (child?.exitCode === null) child.kill(); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker did not retry busy lock")), 5000);
      child!.stdout!.on("data", chunk => { if (String(chunk).includes("store-busy-retrying")) { clearTimeout(timer); resolve(); } });
      child!.once("error", reject);
      child!.once("exit", code => { clearTimeout(timer); reject(new Error(`worker exited under contention: ${code}`)); });
    });
  });
  const code = await new Promise(resolve => child!.once("exit", resolve));
  assert.equal(code, 0); assert.ok((await store.load()).lastCheckAt);
});
