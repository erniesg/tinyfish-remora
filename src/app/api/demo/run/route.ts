import { NextResponse } from "next/server";
import { buildRunLaunch } from "@/lib/demo/engine";
import type { RunRequest } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<RunRequest>;
  return NextResponse.json(buildRunLaunch(body));
}
