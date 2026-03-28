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

  return {
    ...base,
    label: readString(payload.label) ?? base.label,
    runId: base.runId,
    streamUrl: base.streamUrl,
    streamingUrl: base.streamingUrl,
    request: base.request,
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
