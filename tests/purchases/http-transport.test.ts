import test from "node:test";
import assert from "node:assert/strict";
import { createClientPortalTransport } from "../../src/lib/purchases/http-transport";

test("HTTP transport is inert until called, scopes endpoints and never retries unknown writes", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const send: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ orders: [] }); };
  const transport = createClientPortalTransport({ baseUrl: "https://broker.example/v1/api", bearerToken: "test-token", fetch: send });
  assert.equal(calls.length, 0);
  await transport("GET", "/iserver/account/orders?force=true");
  assert.equal(calls[0].url, "https://broker.example/v1/api/iserver/account/orders?force=true");
  assert.equal(calls[0].init?.redirect, "error");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer test-token");
  await transport("POST", "/iserver/account/DU-TEST/orders", { orders: [] });
  assert.equal(calls[1].init?.body, '{"orders":[]}');
  for (const path of ["//other.example/v1/api/iserver/accounts", "/../../iserver/accounts", "/%2e%2e/iserver/accounts", "/iserver/reply/warning", "/iserver/auth/ssodh/init", "/iserver/accounts#bad"]) await assert.rejects(transport("POST", path));
  assert.equal(calls.length, 2);
  let attempts = 0;
  const failing = createClientPortalTransport({ baseUrl: "http://127.0.0.1:5000/v1/api", fetch: async () => { attempts++; throw new Error("private-token/session-body"); } });
  await assert.rejects(failing("POST", "/iserver/account/DU-TEST/orders", {}), /outcome unknown; reconcile/);
  assert.equal(attempts, 1);
  await assert.rejects(failing("GET", "/iserver/accounts"), e => e instanceof Error && !e.message.includes("private-token"));
});

test("HTTP transport rejects unsafe configuration and non-JSON/non-success evidence", async () => {
  for (const baseUrl of ["http://remote.example/v1/api", "https://user:password@broker.example/v1/api", "https://broker.example/v1/api?secret=x", "https://broker.example/health", "file:///v1/api"]) assert.throws(() => createClientPortalTransport({ baseUrl }));
  for (const timeoutMs of [0, -1, 1.5, Infinity, 60001]) assert.throws(() => createClientPortalTransport({ baseUrl: "https://broker.example/v1/api", timeoutMs }));
  for (const response of [new Response("<html>login</html>"), new Response("secret-body", { status: 401 })]) {
    const transport = createClientPortalTransport({ baseUrl: "https://broker.example/v1/api", fetch: async () => response });
    await assert.rejects(transport("GET", "/iserver/accounts"), /evidence request unavailable/);
  }
});
