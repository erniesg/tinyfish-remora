import type { RunLaunchResponse, RunRequest } from "@/lib/demo/types";
import type { TimedEvent } from "@/lib/demo/engine";

export interface RuntimeProvider {
  launchRun(request: Partial<RunRequest>): Promise<RunLaunchResponse>;
  getTimeline(runId: string, request: RunRequest): Promise<TimedEvent[]>;
}
