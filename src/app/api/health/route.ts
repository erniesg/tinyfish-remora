import { NextResponse } from "next/server";

const REQUIRED_ENV = [
  "TINYFISH_RUN_URL",
  "REVIEW_URL",
  "IBKR_GATEWAY_URL",
  "IBKR_ACCOUNT_ID",
] as const;

export async function GET() {
  const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
  const now = new Date().toISOString();
  const degraded = missingEnv.length > 0;

  return NextResponse.json(
    {
      status: degraded ? "degraded" : "ok",
      timestamp: now,
      checks: {
        environment: degraded ? "missing_required_values" : "ok",
      },
      missingEnv,
    },
    {
      status: degraded ? 503 : 200,
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
