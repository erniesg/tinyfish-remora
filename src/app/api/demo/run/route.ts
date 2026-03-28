import { NextResponse } from "next/server";
import { buildRunBatch } from "@/lib/demo/engine";
import type { ExecutionMode } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    recipeIds?: string[];
    strategyId?: string;
    mode?: ExecutionMode;
  };

  return NextResponse.json(
    buildRunBatch({
      recipeIds: body.recipeIds ?? [],
      strategyId: body.strategyId,
      mode: body.mode ?? "paper",
    }),
  );
}
