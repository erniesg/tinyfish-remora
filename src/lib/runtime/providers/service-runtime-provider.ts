import "server-only";

import { buildRunLaunch, resolveRunRequest } from "@/lib/demo/engine";
import type { RunLaunchResponse } from "@/lib/demo/types";
import { getRuntimeConfig } from "@/lib/runtime/env";
import { postRuntimeJson } from "@/lib/runtime/http";
import { buildRuntimeRunTimeline } from "@/lib/runtime/orchestrator";
import type { RuntimeProvider } from "@/lib/runtime/providers/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mergeLaunchResponse(base: RunLaunchResponse, payload: unknown): RunLaunchResponse {
  if (!isObject(payload)) return base;

  const requestPayload = isObject(payload.request) ? payload.request : undefined;
  const mergedRequest = {
    ...base.request,
    ...(requestPayload ?? {}),
    countries: base.request.countries,
    sources: base.request.sources,
    mode: base.request.mode,
    preferredVenue: base.request.preferredVenue,
    promptVersion: base.request.promptVersion,
    strategyId: base.request.strategyId,
  };

  return {
    ...base,
    runId: readString(payload.runId) ?? base.runId,
    label: readString(payload.label) ?? base.label,
    streamUrl: readString(payload.streamUrl) ?? base.streamUrl,
    streamingUrl: readString(payload.streamingUrl) ?? base.streamingUrl,
    request: mergedRequest,
  };
}

export const ServiceRuntimeProvider: RuntimeProvider = {
  async launchRun(requestInput) {
    const base = buildRunLaunch(requestInput);
    const config = getRuntimeConfig();

    if (!config.tinyfishRunUrl) {
      return base;
    }

    try {
      const request = resolveRunRequest(requestInput);
      const payload = await postRuntimeJson<Record<string, unknown>>(
        config.tinyfishRunUrl,
        {
          runId: base.runId,
          request,
          streamUrl: base.streamUrl,
          streamingUrl: base.streamingUrl,
        },
        {
          bearerToken: config.tinyfishApiKey,
          sharedSecret: config.tradingGatewaySharedSecret,
        },
      );

      return mergeLaunchResponse(base, payload);
    } catch {
      return base;
    }
  },

  async getTimeline(runId, request) {
    return buildRuntimeRunTimeline(runId, request);
  },
};
