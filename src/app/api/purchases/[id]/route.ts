import { errorResponse, guardMutation, purchaseService, requestBody } from "@/lib/purchases/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardMutation(request);
    const { id } = await context.params;
    const { action } = await requestBody(request);
    if (action !== "arm" && action !== "revoke" && action !== "cancel" && action !== "refresh") throw new Error("Use arm, revoke, cancel, or refresh action.");
    return Response.json(await purchaseService().action(id, action));
  } catch (error) { return errorResponse(error); }
}
