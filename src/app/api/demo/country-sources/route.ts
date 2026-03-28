import { NextResponse } from "next/server";
import { getCountryRegistry, getSourceRegistry } from "@/lib/demo/registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const countries = (searchParams.get("countries") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return NextResponse.json({
    countries: getCountryRegistry(),
    sources: getSourceRegistry(countries),
  });
}
