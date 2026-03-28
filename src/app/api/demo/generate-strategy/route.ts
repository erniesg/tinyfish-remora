import { NextResponse } from "next/server";
import { generateStrategyFromBrief } from "@/lib/demo/engine";
import type { RiskProfile, VenueCandidate } from "@/lib/demo/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    objective?: string;
    riskProfile?: RiskProfile;
    preferredVenue?: VenueCandidate;
  };

  return NextResponse.json(
    generateStrategyFromBrief(
      body.objective?.trim() || "Find low-latency policy lag trades.",
      body.riskProfile ?? "balanced",
      body.preferredVenue ?? "both",
    ),
  );
}
