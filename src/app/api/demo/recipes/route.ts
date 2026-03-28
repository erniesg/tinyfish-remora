import { NextResponse } from "next/server";
import { getGovernmentRecipeRegistry, getRecipeSources } from "@/lib/demo/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const recipes = getGovernmentRecipeRegistry().map((recipe) => ({
    ...recipe,
    sourceDetails: getRecipeSources(recipe.sources),
  }));

  return NextResponse.json({ recipes });
}
