import { NextResponse } from "next/server";
import { buildRunLaunch } from "@/lib/demo/engine";
import type { RunRequest } from "@/lib/demo/types";
import { buildRuntimeStatus } from "@/lib/runtime/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<RunRequest>;
  const runtime = buildRuntimeStatus();

  return NextResponse.json({
    ...buildRunLaunch(body),
    runtimeMode: runtime.mode,
    runtimeWarnings: runtime.warnings,
  });
}
