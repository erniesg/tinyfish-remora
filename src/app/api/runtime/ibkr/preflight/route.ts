import { NextResponse } from "next/server";

import { runIbkrPreflight, type IbkrPreflightMode } from "@/lib/runtime/ibkr-preflight";

export const dynamic = "force-dynamic";

function parseMode(url: URL): IbkrPreflightMode {
  const mode = url.searchParams.get("mode");
  return mode === "live" ? "live" : "paper";
}

export async function GET(request: Request) {
  const mode = parseMode(new URL(request.url));
  const result = await runIbkrPreflight(mode);

  const status = result.ok ? 200 : result.missing.length > 0 ? 400 : 502;

  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
