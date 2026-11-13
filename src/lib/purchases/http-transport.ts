import type { ClientPortalTransport } from "./broker";

export interface ClientPortalHttpConfig {
  /** Operator-supplied server URL ending in /v1/api. Never take this from a browser request. */
  baseUrl: string;
  bearerToken?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Inactive until explicitly called by a server integration. No environment reads,
 * login, session takeover, reply confirmation, account mutation or retry policy.
 * Keep ClientPortalBroker's separate execution-authority guard in front of writes.
 */
export function createClientPortalTransport(config: ClientPortalHttpConfig): ClientPortalTransport {
  if (typeof window !== "undefined") throw new Error("Client Portal transport is server-only.");
  const base = new URL(config.baseUrl.replace(/\/$/, ""));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && local)) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/v1/api")) throw new Error("Use an HTTPS Client Portal /v1/api URL (HTTP is loopback-only).");
  const timeout = config.timeoutMs ?? 8000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 60000) throw new Error("Client Portal timeout must be between 1 and 60000ms.");
  const send = config.fetch ?? globalThis.fetch;
  return async (method, path, body) => {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) throw new Error("Invalid Client Portal path.");
    const url = new URL(`${base.href}${path}`);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`) || decodeURIComponent(url.pathname).split("/").includes("..")) throw new Error("Invalid Client Portal path.");
    const endpoint = url.pathname.slice(base.pathname.length);
    const allowedGet = /^\/(?:iserver\/(?:auth\/status|accounts|secdef\/(?:search|info)|marketdata\/snapshot|account\/(?:orders|trades)|account\/order\/status\/[^/]+)|portfolio\/[^/]+\/ledger|contract\/trading-schedule)$/;
    const allowed = method === "GET" ? allowedGet.test(endpoint) : method === "POST" ? /^\/iserver\/account\/[^/]+\/orders$/.test(endpoint) : method === "DELETE" && /^\/iserver\/account\/[^/]+\/order\/[^/]+$/.test(endpoint);
    if (!allowed) throw new Error("Client Portal endpoint is outside the purchase adapter scope.");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const response = await send(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error("http");
      return await response.json();
    } catch {
      // A failed write might already have reached IBKR. Do not leak tokens, URLs,
      // session material or raw gateway responses, and NEVER retry here.
      throw new Error(method === "GET" ? "Client Portal evidence request unavailable." : "Client Portal write outcome unknown; reconcile the durable intent before any replacement.");
    }
  };
}
