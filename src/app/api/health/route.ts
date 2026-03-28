import { NextResponse } from "next/server";
import { buildRuntimeStatus } from "@/lib/runtime/env";

export async function GET() {
  const runtime = buildRuntimeStatus();
  const missingOptionalEnv = Array.from(
    new Set(runtime.providers.flatMap((provider) => provider.missing).filter(Boolean)),
  ).sort();
  const now = new Date().toISOString();
  const integrationsDegraded = missingOptionalEnv.length > 0;

  return NextResponse.json(
    {
      status: "ok",
      timestamp: now,
      runtimeMode: runtime.mode,
      checks: {
        environment: "ok",
        integrations: integrationsDegraded ? "optional_values_missing" : "ok",
      },
      missingEnv: [] as string[],
      missingOptionalEnv,
      warnings: runtime.warnings,
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
