import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { PurchaseService, RevisionConflictError, validateInput } from "../../src/lib/purchases/service";
import * as serviceModule from "../../src/lib/purchases/service";
import * as serverModule from "../../src/lib/purchases/server";
import { PurchaseStore } from "../../src/lib/purchases/store";
import { catalog } from "../../src/lib/purchases/catalog";
import type { MandateInput, PurchaseState } from "../../src/lib/purchases/types";

const input: MandateInput = { instrumentId: "aapl-nasdaq", accountId: "mock-cash", trigger: "schedule", scheduledAt: "2026-06-15T13:30:00Z", timezone: "Asia/Singapore", session: "regular", shares: 2, limitPrice: 110, maxSpend: 225, buffer: 5, expiresAt: "2026-06-15T20:00:00Z" };
async function setup(t: { after(fn: () => Promise<void>): void }) {
  const root = path.join(os.homedir(), ".local/state/rucksack/scratch/remora-purchase-tests");
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(path.join(root, "draft-edit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PurchaseStore(path.join(dir, "db.json"));
  const service = new PurchaseService(store, undefined, () => new Date("2026-06-15T14:00:00Z"));
  return { store, service };
}

test("draft editing replaces complete saved terms/snapshot, preserves identity/audit, and increments revisions", async t => {
  const { store, service } = await setup(t);
  const draft = await service.create(input);
  assert.equal(draft.revision, 0);
  const instrument = catalog.find(i => i.listing === "verified" && i.id !== input.instrumentId)!;
  const changed = { ...input, instrumentId: instrument.id, shares: 3, limitPrice: 12, maxSpend: 45, buffer: 9, trigger: "opening" as const, timezone: "UTC" };
  const revised = await service.editDraft(draft.id, { ...changed, id: "injected", reserved: 999, state: "armed" }, 0);
  assert.equal(revised.id, draft.id); assert.equal(revised.createdAt, draft.createdAt);
  for (const [key, value] of Object.entries(validateInput(changed))) assert.equal(revised[key as keyof MandateInput], value);
  assert.deepEqual(revised.instrumentSnapshot, instrument);
  assert.equal(revised.accountMode, "mock"); assert.equal(revised.state, "draft"); assert.equal(revised.reserved, 0);
  assert.deepEqual(revised.receipts.slice(0, -1), draft.receipts);
  assert.equal(revised.receipts.at(-1)?.kind, "revised"); assert.equal(revised.revision, 1);
  assert.equal((await service.editDraft(draft.id, input, 1)).revision, 2);
  assert.deepEqual((await store.load()).mockOrders, {});
});

test("stale edit/arm and invalid complete inputs leave durable state unchanged", async t => {
  const { store, service } = await setup(t);
  const draft = await service.create(input);
  await service.editDraft(draft.id, { ...input, shares: 1 }, 0);
  const before = await readFile(store.filename, "utf8");
  await assert.rejects(service.editDraft(draft.id, input, 0), RevisionConflictError);
  await assert.rejects(service.action(draft.id, "arm", 0), RevisionConflictError);
  for (const value of [{ shares: 1 }, { ...input, instrumentId: "unknown" }, { ...input, timezone: "invented" }]) await assert.rejects(service.editDraft(draft.id, value, 1));
  for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(service.editDraft(draft.id, input, revision), /safe integer/);
  assert.equal(await readFile(store.filename, "utf8"), before);
  assert.equal((await service.action(draft.id, "arm", 1)).state, "armed");
});

test("legacy missing revision is initial zero; malformed durable revisions fail closed", async t => {
  const { store, service } = await setup(t);
  const draft = await service.create(input);
  await store.transaction(async tx => { delete tx.data.purchases[0].revision; });
  const original = await readFile(store.filename, "utf8");
  for (const revision of [-1, 0.5, null, "0", Number.MAX_SAFE_INTEGER + 1]) {
    const db = JSON.parse(original); db.purchases[0].revision = revision;
    await writeFile(store.filename, JSON.stringify(db));
    await assert.rejects(store.load(), /recovery required/);
  }
  await writeFile(store.filename, original);
  assert.equal((await service.editDraft(draft.id, input, 0)).revision, 1);
});

test("unresolved and blocked inactive drafts are editable without inventing listing facts or authority", async t => {
  const { store, service } = await setup(t);
  const unresolved = catalog.find(i => i.listing === "unconfirmed")!;
  const draft = await service.create({ ...input, instrumentId: unresolved.id });
  assert.equal((await service.action(draft.id, "arm", 0)).state, "waiting-for-listing");
  const revised = await service.editDraft(draft.id, { ...input, instrumentId: unresolved.id, shares: 1 }, 0);
  assert.deepEqual(revised.instrumentSnapshot, unresolved);
  assert.equal(revised.instrumentSnapshot.currency, ""); assert.equal(revised.instrumentSnapshot.timezone, "");
  assert.equal(revised.state, "draft"); assert.equal(revised.reserved, 0); assert.equal(revised.intentId, undefined);
  assert.deepEqual(revised.reasons, service.preview(revised).reasons);
  const blocked = await service.create({ ...input, maxSpend: 1 });
  assert.equal((await service.action(blocked.id, "arm", 0)).state, "blocked");
  assert.equal((await service.editDraft(blocked.id, input, 0)).state, "draft");
  assert.deepEqual((await store.load()).mockOrders, {});
});

test("every active/terminal state and prior authority is immutable even if subsequently blocked", async t => {
  const { store, service } = await setup(t);
  const draft = await service.create(input);
  const original = await readFile(store.filename, "utf8");
  // Inject state in the loaded transaction to exercise edit eligibility independently of schema constraints.
  const states: PurchaseState[] = ["armed", "waiting-for-opening", "submitted", "partially-filled", "filled", "cancellation-pending", "cancelled", "expired", "revoked", "reconciliation-required"];
  const mutations = [
    ...states.map(state => ({ state })), { intentId: "unknown" }, { reserved: 1 }, { revoked: true }, { stopRequested: "expired" as const }, { filledShares: 1 }, { spent: 1 },
    { state: "blocked" as const, receipts: [...draft.receipts, { at: draft.createdAt, kind: "armed", message: "Prior grant", evidence: "mock" as const }] },
  ];
  for (const mutation of mutations) {
    const guarded = new PurchaseService({ transaction: async fn => {
      const db = JSON.parse(original); Object.assign(db.purchases[0], mutation);
      return fn({ data: db, save: async () => { throw new Error("Unexpected save"); } });
    } } as PurchaseStore);
    await assert.rejects(guarded.editDraft(draft.id, input, 0), /never-armed/);
  }
  await service.action(draft.id, "arm", 0);
  await store.transaction(async tx => { tx.data.purchases[0].state = "blocked"; tx.data.purchases[0].reserved = 0; });
  await assert.rejects(service.editDraft(draft.id, input, 0), /never-armed/);
  await assert.rejects(service.editDraft("missing", input, 0), /not found/);
});

test("simultaneous edit/arm serializes safely; either winner prevents unseen changed terms from arming", async t => {
  const { store, service } = await setup(t);
  const draft = await service.create(input);
  const results = await Promise.allSettled([service.editDraft(draft.id, { ...input, shares: 1 }, 0), service.action(draft.id, "arm", 0)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const saved = (await store.load()).purchases[0];
  if (saved.revision === 1) {
    assert.equal(saved.state, "draft"); assert.equal(saved.reserved, 0);
    await assert.rejects(service.action(draft.id, "arm", 0), RevisionConflictError);
  } else {
    assert.equal(saved.state, "armed"); assert.equal(saved.shares, input.shares);
    await assert.rejects(service.editDraft(draft.id, { ...input, shares: 1 }, 0), /never-armed/);
  }
  assert.deepEqual((await store.load()).mockOrders, {});
});

test("public action route requires revision, returns 409 on stale arm/edit, and stop/refresh ignore stale revision", async t => {
  const { store, service } = await setup(t);
  // Execute the actual route source, transpiled in isolation; inject only its service factory (no HTTP server/network).
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const ts = require("typescript");
  const source = await readFile("src/app/api/purchases/[id]/route.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { POST?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  runInNewContext(compiled, { exports, Response, require: (name: string) => name.endsWith("/server") ? { ...serverModule, purchaseService: () => service } : serviceModule });
  const previous = { mode: process.env.REMORA_PURCHASE_MODE, store: process.env.REMORA_PURCHASE_STORE };
  process.env.REMORA_PURCHASE_MODE = "mock"; process.env.REMORA_PURCHASE_STORE = store.filename;
  t.after(async () => {
    if (previous.mode === undefined) delete process.env.REMORA_PURCHASE_MODE; else process.env.REMORA_PURCHASE_MODE = previous.mode;
    if (previous.store === undefined) delete process.env.REMORA_PURCHASE_STORE; else process.env.REMORA_PURCHASE_STORE = previous.store;
  });
  const draft = await service.create(input);
  const post = (body: unknown) => exports.POST!(new Request("http://localhost/api/purchases/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: draft.id }) });
  for (const expectedRevision of [undefined, null, -1, 0.5, "0"]) assert.equal((await post({ action: "arm", expectedRevision })).status, 400);
  const edited = await post({ action: "edit", input: { ...input, shares: 1 }, expectedRevision: 0 });
  assert.equal(edited.status, 200); assert.equal((await edited.json()).revision, 1);
  const before = await readFile(store.filename, "utf8");
  for (const action of ["arm", "edit"]) {
    const response = await post({ action, input, expectedRevision: 0 });
    assert.equal(response.status, 409); assert.match((await response.json()).error, /Reload/);
  }
  assert.equal(await readFile(store.filename, "utf8"), before);
  assert.equal((await post({ action: "arm", expectedRevision: 1 })).status, 200);
  assert.equal((await post({ action: "refresh", expectedRevision: 0 })).status, 200);
  assert.equal((await post({ action: "revoke", expectedRevision: 0 })).status, 200);
  assert.equal((await store.load()).purchases[0].state, "revoked");
  assert.equal((await post({ action: "cancel" })).status, 200);
});
