import os from "node:os";
import path from "node:path";
import { PurchaseStore } from "./store";
import { PurchaseService } from "./service";

export function purchaseService() {
  const configured = process.env.REMORA_PURCHASE_STORE;
  return new PurchaseService(new PurchaseStore(configured || path.join(os.homedir(), ".local/state/tinyfish-remora/purchases.json")));
}
export function mutationEnabled() { return process.env.REMORA_PURCHASE_MODE === "mock" && Boolean(process.env.REMORA_PURCHASE_STORE); }
export function guardMutation(request: Request) {
  if (!mutationEnabled()) throw new Error("Mutations held. Set REMORA_PURCHASE_MODE=mock and REMORA_PURCHASE_STORE to an absolute private path outside the project.");
  const url = new URL(request.url);
  const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  // Next may normalize Request.url to localhost even when the browser uses 127.0.0.1.
  // Trust neither forwarded headers nor arbitrary Host values: both hosts must be loopback.
  const browserUrl = new URL(`${url.protocol}//${request.headers.get("host") || url.host}`);
  if (!loopback(url.hostname) || !loopback(browserUrl.hostname)) throw new Error("Purchase mutation is local-only.");
  const origin = request.headers.get("origin");
  if (origin && origin !== browserUrl.origin) throw new Error("Cross-origin purchase mutation is forbidden.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("JSON content type required.");
}
export async function requestBody(request: Request) {
  const text = await request.text();
  if (text.length > 16384) throw new Error("Purchase request too large.");
  return JSON.parse(text) as Record<string, unknown>;
}
export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Purchase operation unavailable.";
  return Response.json({ error: message }, { status: /held|forbidden|local-only/.test(message) ? 403 : /locked/.test(message) ? 409 : 400 });
}
