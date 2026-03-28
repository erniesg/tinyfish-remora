import "server-only";

import { buildRunLaunch, buildRunTimeline } from "@/lib/demo/engine";
import type { RuntimeProvider } from "@/lib/runtime/providers/types";

export const DemoRuntimeProvider: RuntimeProvider = {
  async launchRun(request) {
    return buildRunLaunch(request);
  },
  async getTimeline(runId, request) {
    return buildRunTimeline(runId, request);
  },
};
