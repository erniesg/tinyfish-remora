import { NextResponse } from "next/server";
import { buildRuntimeStatus } from "@/lib/runtime/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildRuntimeStatus(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
