import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PurchaseStore } from "../../src/lib/purchases/store";
import { PurchaseService } from "../../src/lib/purchases/service";
import { ClientPortalBroker, MockBroker, OrderNotSent } from "../../src/lib/purchases/broker";
import type { Preflight } from "../../src/lib/purchases/broker";
import type { MandateInput, Purchase } from "../../src/lib/purchases/types";

const input: MandateInput = { instrumentId: "aapl-nasdaq", accountId: "mock-cash", trigger: "schedule", scheduledAt: "2026-06-15T14:00:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, maxSpend: 225, buffer: 5, expiresAt: "2026-06-15T20:01:00Z" };
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = path.join(os.homedir(), ".local/state/rucksack/scratch/remora-purchase-tests");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "expiry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PurchaseStore(path.join(dir, "db.json"));
  let now = new Date(input.scheduledAt), sends = 0, preflights = 0;
  let afterPreflight: (p: Purchase, f: Preflight) => void = () => {};
  let afterSave: (p: Purchase) => void = () => {};
  const service = () => new PurchaseService(store, tx => {
    const save = tx.save.bind(tx);
    tx.save = async () => { await save(); for (const p of tx.data.purchases) afterSave(p); };
    const broker = new MockBroker(tx);
    const preflight = broker.preflight.bind(broker), submit = broker.submit.bind(broker);
    broker.preflight = async (p, i, at) => { preflights++; const f = await preflight(p, i, at); afterPreflight(p, f); return f; };
    broker.submit = async p => { sends++; return submit(p); };
    return broker;
  }, () => now);
  const arm = async (changes: Partial<MandateInput> = {}) => {
    const s = service(); return s.action((await s.create({ ...input, ...changes })).id, "arm");
  };
  return { store, service, arm, time: (at: string) => { now = new Date(at); },
    preflightHook: (fn: typeof afterPreflight) => { afterPreflight = fn; }, saveHook: (fn: typeof afterSave) => { afterSave = fn; },
    sends: () => sends, preflights: () => preflights };
}

for (const phase of ["preflight", "prepared", "attempted"] as const) {
  test(`expiry during awaited ${phase} never submits; durable identity retained after intent`, async t => {
    const h = await setup(t);
    await h.arm({ expiresAt: "2026-06-15T14:00:01Z" });
    const advance = () => h.time("2026-06-15T14:00:02Z");
    if (phase === "preflight") h.preflightHook(advance);
    else h.saveHook(p => { if (p.submitPhase === phase) advance(); });
    const [p] = await h.service().tick();
    assert.equal(h.sends(), 0); assert.equal(p.state, "expired"); assert.equal(p.reserved, 0);
    if (phase !== "preflight") {
      assert.ok(p.intentId); assert.equal(p.submitPhase, "prepared");
      assert.ok(p.receipts.some(r => r.kind === "not-sent"));
    }
    assert.equal((await h.store.load()).purchases[0].state, "expired");
    await h.service().tick(); assert.equal(h.sends(), 0);
  });
}

test("later mandate refreshes time after an earlier mandate's awaited work", async t => {
  const h = await setup(t);
  const first = await h.arm(); await h.arm({ expiresAt: "2026-06-15T14:00:01Z" });
  h.preflightHook(p => { if (p.id === first.id) h.time("2026-06-15T14:00:02Z"); });
  const rows = await h.service().tick();
  assert.equal(rows[0].state, "filled"); assert.equal(rows[1].state, "expired");
  assert.equal(h.preflights(), 1); assert.equal(h.sends(), 1);
});

for (const phase of ["preflight", "prepared", "attempted"] as const) {
  for (const source of ["quote", "trust", "session"] as const) {
    test(`${source} expires during ${phase}; no order effect`, async t => {
      const h = await setup(t); await h.arm();
      const advance = () => h.time(source === "session" ? "2026-06-15T20:00:00Z" : source === "trust" ? "2026-06-15T14:00:02Z" : "2026-06-15T14:00:31Z");
      h.preflightHook((_p, f) => {
        if (source === "quote") f.validUntil = "2026-06-15T19:00:00Z";
        if (source === "trust") f.validUntil = "2026-06-15T14:00:01Z";
        if (phase === "preflight") advance();
      });
      if (phase !== "preflight") h.saveHook(p => { if (p.submitPhase === phase) advance(); });
      const [p] = await h.service().tick();
      assert.equal(h.sends(), 0);
      assert.equal(p.state, source === "session" ? "expired" : phase === "preflight" ? "blocked" : "reconciliation-required");
      assert.equal(p.reserved, source === "session" ? 0 : input.maxSpend);
      await h.store.load();
    });
  }
}

test("proven local NOT SENT recovers unattended after restart using same durable identity; unknown attempted never retries", async t => {
  const h = await setup(t); await h.arm();
  h.saveHook(p => { if (p.submitPhase === "prepared") h.time("2026-06-15T14:00:31Z"); });
  const [waiting] = await h.service().tick();
  assert.equal(waiting.submitPhase, "prepared"); assert.equal(h.sends(), 0);
  h.saveHook(() => {});
  const [filled] = await h.service().tick();
  assert.equal(filled.state, "filled"); assert.equal(filled.intentId, waiting.intentId);
  assert.equal(filled.receipts.filter(r => r.kind === "intent-created").length, 1);
  assert.equal(h.sends(), 1);
  // A crash after attempted persistence but before the call cannot prove NOT SENT.
  const h2 = await setup(t); await h2.arm();
  h2.saveHook(p => { if (p.submitPhase === "attempted") throw new Error("process lost after save"); });
  await assert.rejects(h2.service().tick(), /process lost/);
  h2.saveHook(() => {});
  const [unknown] = await h2.service().tick();
  assert.equal(unknown.submitPhase, "attempted"); assert.equal(unknown.state, "reconciliation-required");
  assert.equal(unknown.reserved, input.maxSpend); assert.equal(h2.sends(), 0);
});

test("prepared intent can be revoked locally, while invalid durable phases fail closed", async t => {
  const h = await setup(t); const armed = await h.arm();
  h.saveHook(p => { if (p.submitPhase === "prepared") h.time("2026-06-15T14:00:31Z"); });
  await h.service().tick(); h.saveHook(() => {});
  await assert.rejects(h.store.transaction(async tx => { tx.data.purchases[0].submitPhase = "invalid" as "prepared"; }), /recovery required/);
  await assert.rejects(h.store.transaction(async tx => { tx.data.purchases[0].brokerOrderId = "unexpected"; }), /recovery required/);
  const stopped = await h.service().action(armed.id, "revoke");
  assert.equal(stopped.state, "revoked"); assert.equal(stopped.reserved, 0); assert.ok(stopped.intentId);
  await h.service().tick(); assert.equal(h.sends(), 0);
  await h.store.load();
});

test("Client Portal write boundary uses injected current clock, not historical preflight time", async t => {
  const h = await setup(t); await h.arm();
  h.saveHook(p => { if (p.submitPhase === "prepared") h.time("2026-06-15T14:00:31Z"); });
  const [local] = await h.service().tick();
  const instrument = { ...local.instrumentSnapshot, evidence: "broker-verified" as const };
  const p: Purchase = { ...local, accountMode: "paper", instrumentSnapshot: instrument, contract: { ...local.contract!, evidence: "broker-verified" } };
  let posts = 0;
  let at = new Date("2026-06-15T14:00:00Z");
  const adapter = new ClientPortalBroker(async () => { posts++; return []; }, p.accountId, "paper", { preflight: async () => { throw new Error("not used"); }, executionAllowed: () => true }, () => at);
  const f = { validUntil: "2026-06-15T14:00:30Z", quoteAt: "2026-06-15T14:00:00Z", sessionOpensAt: "2026-06-15T13:30:00Z", sessionClosesAt: "2026-06-15T20:00:00Z" } as Preflight;
  for (const time of ["2026-06-15T14:00:31Z", "2026-06-15T20:00:00Z", "2026-06-15T20:01:00Z"]) {
    at = new Date(time);
    await assert.rejects(adapter.submit(p, instrument, f), OrderNotSent);
  }
  await assert.rejects(adapter.submit(p, instrument), OrderNotSent);
  assert.equal(posts, 0);
});

test("unresolved issuer expires or revokes without guessed timezone or reservation", async t => {
  for (const stop of ["expiry", "revoke"] as const) {
    const h = await setup(t);
    const p = await h.arm({ instrumentId: "anthropic-unconfirmed", expiresAt: "2026-06-15T14:00:01Z" });
    assert.equal(p.reasons.length, 1);
    if (stop === "expiry") h.time("2026-06-15T14:00:02Z");
    else await h.service().action(p.id, "revoke");
    const [ended] = await h.service().tick();
    assert.equal(ended.state, stop === "expiry" ? "expired" : "revoked");
    assert.equal(ended.reserved, 0); assert.equal(h.preflights(), 0); assert.equal(h.sends(), 0);
    assert.equal((await h.store.load()).purchases[0].instrumentSnapshot.currency, "");
  }
});
