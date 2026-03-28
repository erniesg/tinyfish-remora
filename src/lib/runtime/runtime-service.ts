import "server-only";

import type { RunRequest } from "@/lib/demo/types";
import type { TimedEvent } from "@/lib/demo/engine";
import { getRuntimeConfig } from "@/lib/runtime/env";
import {
  DemoRuntimeProvider,
  type RuntimeProvider,
  ServiceRuntimeProvider,
} from "@/lib/runtime/providers";

function resolveRuntimeProvider(): RuntimeProvider {
  const config = getRuntimeConfig();

  if (config.tinyfishRunUrl) {
    return ServiceRuntimeProvider;
  }

  return DemoRuntimeProvider;
}

export async function launchRuntimeRun(request: Partial<RunRequest>) {
  return resolveRuntimeProvider().launchRun(request);
}

export async function getRuntimeTimeline(runId: string, request: RunRequest): Promise<TimedEvent[]> {
  return resolveRuntimeProvider().getTimeline(runId, request);
}
