import { NextResponse } from "next/server";
import type { RunRequest } from "@/lib/demo/types";
import { buildRuntimeStatus } from "@/lib/runtime/env";
import { launchRuntimeRun } from "@/lib/runtime/runtime-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<RunRequest>;
  const runtime = buildRuntimeStatus();

  const launch = await launchRuntimeRun(body);

  return NextResponse.json({
    ...launch,
    runtimeMode: runtime.mode,
    runtimeWarnings: runtime.warnings,
  });
}
