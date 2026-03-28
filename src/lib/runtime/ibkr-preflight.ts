import "server-only";

import { getRuntimeConfig, type RuntimeConfig } from "@/lib/runtime/env";

export type IbkrPreflightMode = "paper" | "live";
export type IbkrPreflightSource = "stub" | "gateway" | "config";

export interface IbkrPreflightResult {
  ok: boolean;
  mode: IbkrPreflightMode;
  source: IbkrPreflightSource;
  checkedAt: string;
  gateway: {
    url: string;
    reachable: boolean;
    statusCode?: number;
  };
  account: {
    requestedId?: string;
    present: boolean;
    availableIds: string[];
  };
  capabilities: {
    readOnly: boolean;
    supportsPreflight: boolean;
    supportsOrderPreview: boolean;
  };
  warnings: string[];
  missing: string[];
  note: string;
}

interface GatewayHealthResponse {
  accountIds?: unknown;
  capabilities?: {
    readOnly?: unknown;
    supportsPreflight?: unknown;
    supportsOrderPreview?: unknown;
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function isStubGateway(url: string): boolean {
  return url.startsWith("stub://") || url.startsWith("mock://");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function baseResult(mode: IbkrPreflightMode, config: RuntimeConfig, checkedAt: string): IbkrPreflightResult {
  return {
    ok: false,
    mode,
    source: "config",
    checkedAt,
    gateway: {
      url: config.ibkrGatewayUrl ?? "",
      reachable: false,
    },
    account: {
      requestedId: config.ibkrAccountId,
      present: false,
      availableIds: [],
    },
    capabilities: {
      readOnly: true,
      supportsPreflight: false,
      supportsOrderPreview: false,
    },
    warnings: [],
    missing: [],
    note: "IBKR preflight did not run.",
  };
}

function buildMissingConfig(mode: IbkrPreflightMode, config: RuntimeConfig): string[] {
  const missing: string[] = [];
  if (!config.ibkrGatewayUrl) missing.push("IBKR_GATEWAY_URL");
  if (!config.ibkrAccountId) missing.push("IBKR_ACCOUNT_ID");
  if (mode === "live" && !config.ibkrApiToken) missing.push("IBKR_API_TOKEN");
  return missing;
}

function runStubPreflight(mode: IbkrPreflightMode, config: RuntimeConfig, checkedAt: string): IbkrPreflightResult {
  const requestedId = config.ibkrAccountId;
  const availableIds = requestedId ? [requestedId] : ["DU1234567"];
  const present = requestedId ? availableIds.includes(requestedId) : false;

  return {
    ok: present,
    mode,
    source: "stub",
    checkedAt,
    gateway: {
      url: config.ibkrGatewayUrl ?? "stub://ibkr-gateway",
      reachable: true,
      statusCode: 200,
    },
    account: {
      requestedId,
      present,
      availableIds,
    },
    capabilities: {
      readOnly: true,
      supportsPreflight: true,
      supportsOrderPreview: true,
    },
    warnings:
      mode === "live"
        ? ["Stub mode does not validate real live routing controls."]
        : ["Stub mode validates topology and contract only."],
    missing: [],
    note:
      "IBKR stub preflight completed without placing orders. Use a real gateway URL to validate production reachability.",
  };
}

async function runGatewayPreflight(
  mode: IbkrPreflightMode,
  config: RuntimeConfig,
  checkedAt: string,
): Promise<IbkrPreflightResult> {
  const url = normalizeBaseUrl(config.ibkrGatewayUrl ?? "");
  const endpoint = `${url}/health`;
  const headers = new Headers({
    Accept: "application/json",
    "x-ibkr-account-id": config.ibkrAccountId ?? "",
  });

  if (config.ibkrApiToken) {
    headers.set("Authorization", `Bearer ${config.ibkrApiToken}`);
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    const payload = response.ok ? ((await response.json()) as GatewayHealthResponse) : null;
    const availableIds = asStringArray(payload?.accountIds);
    const requestedId = config.ibkrAccountId;
    const present = requestedId ? availableIds.includes(requestedId) : false;

    const readOnly = payload?.capabilities?.readOnly === false ? false : true;
    const supportsPreflight = payload?.capabilities?.supportsPreflight === false ? false : true;
    const supportsOrderPreview =
      payload?.capabilities?.supportsOrderPreview === true || supportsPreflight;

    return {
      ok: response.ok && present,
      mode,
      source: "gateway",
      checkedAt,
      gateway: {
        url,
        reachable: response.ok,
        statusCode: response.status,
      },
      account: {
        requestedId,
        present,
        availableIds,
      },
      capabilities: {
        readOnly,
        supportsPreflight,
        supportsOrderPreview,
      },
      warnings: [
        ...(readOnly ? [] : ["Gateway reports non-read-only mode; keep execution routes blocked during preflight."]),
        ...(present ? [] : ["Configured account was not returned by gateway health response."]),
      ],
      missing: [],
      note: response.ok
        ? "Gateway health preflight completed without trade submission."
        : `Gateway health endpoint returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      source: "gateway",
      checkedAt,
      gateway: {
        url,
        reachable: false,
      },
      account: {
        requestedId: config.ibkrAccountId,
        present: false,
        availableIds: [],
      },
      capabilities: {
        readOnly: true,
        supportsPreflight: false,
        supportsOrderPreview: false,
      },
      warnings: [error instanceof Error ? error.message : "Gateway request failed."],
      missing: [],
      note: "Gateway preflight failed before any execution path was invoked.",
    };
  }
}

export async function runIbkrPreflight(mode: IbkrPreflightMode = "paper"): Promise<IbkrPreflightResult> {
  const checkedAt = new Date().toISOString();
  const config = getRuntimeConfig();
  const result = baseResult(mode, config, checkedAt);

  const missing = buildMissingConfig(mode, config);
  if (missing.length > 0) {
    return {
      ...result,
      missing,
      note: `Missing ${missing.join(", ")} for ${mode} preflight.`,
    };
  }

  const gatewayUrl = normalizeBaseUrl(config.ibkrGatewayUrl ?? "");
  if (isStubGateway(gatewayUrl)) {
    return runStubPreflight(mode, { ...config, ibkrGatewayUrl: gatewayUrl }, checkedAt);
  }

  return runGatewayPreflight(mode, { ...config, ibkrGatewayUrl: gatewayUrl }, checkedAt);
}
