import "server-only";

import { existsSync, readFileSync } from "node:fs";

import type { VenueConnection } from "@/lib/demo/types";
import type { RuntimeProviderStatus, RuntimeStatusResponse } from "@/lib/runtime/types";

export interface RuntimeConfig {
  openAiApiKey?: string;
  reviewUrl?: string;
  tinyfishApiKey?: string;
  tinyfishRunUrl?: string;
  ibkrAccountId?: string;
  ibkrApiToken?: string;
  ibkrGatewayUrl?: string;
  tradingGatewaySharedSecret?: string;
  polyApiKey?: string;
  polyApiSecret?: string;
  polyPassphrase?: string;
  polyWalletAddress?: string;
  polyFunderAddress?: string;
  polygonPrivateKey?: string;
  polymarketGatewayUrl?: string;
}

let cachedDevVars: Record<string, string> | null = null;
const DEV_VARS_FILES = [".dev.vars", ".dev.vars.local"] as const;

function loadDevVars(): Record<string, string> {
  if (cachedDevVars) return cachedDevVars;
  if (process.env.NODE_ENV === "production") {
    cachedDevVars = {};
    return cachedDevVars;
  }

  const values: Record<string, string> = {};

  for (const candidate of DEV_VARS_FILES) {
    if (!existsSync(candidate)) continue;

    const contents = readFileSync(candidate, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const delimiterIndex = line.indexOf("=");
      if (delimiterIndex <= 0) continue;

      const key = line.slice(0, delimiterIndex).trim();
      const value = line.slice(delimiterIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && value) {
        values[key] = value;
      }
    }
  }

  cachedDevVars = values;
  return values;
}

function readEnv(...names: string[]): string | undefined {
  const devVars = loadDevVars();

  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;

    const devVarValue = devVars[name]?.trim();
    if (devVarValue) return devVarValue;
  }

  return undefined;
}

function configuredMarker(value: string | undefined): string {
  return value ? "configured-via-env" : "";
}

function buildConnection(
  connection: Omit<VenueConnection, "status" | "statusNote" | "fields"> & {
    fields: Record<string, string | undefined>;
    missingEnvNames: string[];
  },
): VenueConnection {
  const missing = connection.missingEnvNames.filter(Boolean);
  const complete = missing.length === 0;

  return {
    id: connection.id,
    venue: connection.venue,
    mode: connection.mode,
    label: connection.label,
    description: connection.description,
    fields: Object.fromEntries(
      Object.entries(connection.fields).map(([field, value]) => [field, configuredMarker(value)]),
    ),
    status: complete ? (connection.mode === "live" ? "warning" : "ready") : missing.length === Object.keys(connection.fields).length ? "missing" : "warning",
    statusNote: complete
      ? connection.mode === "live"
        ? "Environment-backed gateway is configured. Keep operator confirmation enabled before live routing."
        : "Environment-backed paper routing is configured."
      : `Missing ${missing.join(", ")}.`,
  };
}

function buildProviderStatus(
  provider: RuntimeProviderStatus["provider"],
  required: Array<[name: string, value: string | undefined]>,
  noteWhenReady: string,
): RuntimeProviderStatus {
  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  return {
    provider,
    enabled: missing.length === 0,
    missing,
    note: missing.length === 0 ? noteWhenReady : `Fallback active until ${missing.join(", ")} are set.`,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    openAiApiKey: readEnv("OPENAI_API_KEY"),
    reviewUrl: readEnv("REVIEW_URL"),
    tinyfishApiKey: readEnv("TINYFISH_API_KEY"),
    tinyfishRunUrl: readEnv("TINYFISH_RUN_URL"),
    ibkrAccountId: readEnv("IBKR_ACCOUNT_ID"),
    ibkrApiToken: readEnv("IBKR_API_TOKEN"),
    ibkrGatewayUrl: readEnv("IBKR_GATEWAY_URL"),
    tradingGatewaySharedSecret: readEnv("REMORA_TRADING_SECRET", "TRADING_GATEWAY_SHARED_SECRET"),
    polyApiKey: readEnv("POLY_API_KEY", "POLYMARKET_API_KEY"),
    polyApiSecret: readEnv("POLY_API_SECRET", "POLYMARKET_API_SECRET"),
    polyPassphrase: readEnv("POLY_PASSPHRASE", "POLYMARKET_PASSPHRASE"),
    polyWalletAddress: readEnv("POLY_WALLET_ADDRESS"),
    polyFunderAddress: readEnv("POLY_FUNDER_ADDRESS"),
    polygonPrivateKey: readEnv("POLYGON_PRIVATE_KEY"),
    polymarketGatewayUrl: readEnv("POLYMARKET_GATEWAY_URL"),
  };
}

export function buildRuntimeStatus(): RuntimeStatusResponse {
  const config = getRuntimeConfig();
  const providers: RuntimeProviderStatus[] = [
    buildProviderStatus(
      "tinyfish",
      [["TINYFISH_RUN_URL", config.tinyfishRunUrl]],
      config.tinyfishApiKey
        ? "TinyFish collector is configured for server-side runs with API-key auth."
        : "TinyFish collector is configured for server-side runs. Add TINYFISH_API_KEY when the upstream requires auth.",
    ),
    buildProviderStatus(
      "review",
      [["REVIEW_URL", config.reviewUrl]],
      "Review service is configured for server-side signal scoring.",
    ),
    buildProviderStatus(
      "ibkr",
      [
        ["IBKR_GATEWAY_URL", config.ibkrGatewayUrl],
        ["IBKR_ACCOUNT_ID", config.ibkrAccountId],
        ["IBKR_API_TOKEN", config.ibkrApiToken],
      ],
      "IBKR gateway is configured for paper and live execution requests.",
    ),
    buildProviderStatus(
      "polymarket",
      [
        ["POLYMARKET_GATEWAY_URL", config.polymarketGatewayUrl],
        ["POLY_WALLET_ADDRESS", config.polyWalletAddress],
        ["POLY_API_KEY", config.polyApiKey],
        ["POLY_API_SECRET", config.polyApiSecret],
        ["POLY_PASSPHRASE", config.polyPassphrase],
        ["POLYGON_PRIVATE_KEY", config.polygonPrivateKey],
      ],
      "Polymarket gateway is configured for paper and live execution requests.",
    ),
  ];

  const enabledCount = providers.filter((provider) => provider.enabled).length;
  const mode =
    enabledCount === 0 ? "demo" : enabledCount === providers.length ? "live" : "hybrid";

  const connections: VenueConnection[] = [
    buildConnection({
      id: "ibkr-paper",
      venue: "ibkr",
      mode: "paper",
      label: "IBKR Paper",
      description: "Environment-backed IBKR paper routing via the first-party execution gateway.",
      fields: {
        accountId: config.ibkrAccountId,
        gatewayUrl: config.ibkrGatewayUrl,
      },
      missingEnvNames: [
        config.ibkrAccountId ? "" : "IBKR_ACCOUNT_ID",
        config.ibkrGatewayUrl ? "" : "IBKR_GATEWAY_URL",
      ],
    }),
    buildConnection({
      id: "ibkr-live",
      venue: "ibkr",
      mode: "live",
      label: "IBKR Live",
      description: "Environment-backed IBKR live routing with server-side auth and confirmation gates.",
      fields: {
        accountId: config.ibkrAccountId,
        gatewayUrl: config.ibkrGatewayUrl,
        apiToken: config.ibkrApiToken,
      },
      missingEnvNames: [
        config.ibkrAccountId ? "" : "IBKR_ACCOUNT_ID",
        config.ibkrGatewayUrl ? "" : "IBKR_GATEWAY_URL",
        config.ibkrApiToken ? "" : "IBKR_API_TOKEN",
      ],
    }),
    buildConnection({
      id: "polymarket-paper",
      venue: "polymarket",
      mode: "paper",
      label: "Polymarket Paper",
      description: "Environment-backed Polymarket paper routing via the first-party market gateway.",
      fields: {
        gatewayUrl: config.polymarketGatewayUrl,
        walletAddress: config.polyWalletAddress,
      },
      missingEnvNames: [
        config.polymarketGatewayUrl ? "" : "POLYMARKET_GATEWAY_URL",
        config.polyWalletAddress ? "" : "POLY_WALLET_ADDRESS",
      ],
    }),
    buildConnection({
      id: "polymarket-live",
      venue: "polymarket",
      mode: "live",
      label: "Polymarket Live",
      description: "Environment-backed Polymarket live routing with wallet signing and L2 credentials.",
      fields: {
        gatewayUrl: config.polymarketGatewayUrl,
        walletAddress: config.polyWalletAddress,
        apiKey: config.polyApiKey,
        apiSecret: config.polyApiSecret,
        passphrase: config.polyPassphrase,
        privateKey: config.polygonPrivateKey,
      },
      missingEnvNames: [
        config.polymarketGatewayUrl ? "" : "POLYMARKET_GATEWAY_URL",
        config.polyWalletAddress ? "" : "POLY_WALLET_ADDRESS",
        config.polyApiKey ? "" : "POLY_API_KEY",
        config.polyApiSecret ? "" : "POLY_API_SECRET",
        config.polyPassphrase ? "" : "POLY_PASSPHRASE",
        config.polygonPrivateKey ? "" : "POLYGON_PRIVATE_KEY",
      ],
    }),
  ];

  return {
    mode,
    providers,
    connections,
    warnings: providers.filter((provider) => !provider.enabled).map((provider) => provider.note),
  };
}
