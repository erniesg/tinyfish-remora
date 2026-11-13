import { errorResponse, guardMutation, purchaseService, requestBody } from "@/lib/purchases/server";
import { RevisionConflictError } from "@/lib/purchases/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardMutation(request);
    const { id } = await context.params;
    const { action, input, expectedRevision } = await requestBody(request);
    if (action !== "edit" && action !== "arm" && action !== "revoke" && action !== "cancel" && action !== "refresh") throw new Error("Use edit, arm, revoke, cancel, or refresh action.");
    if ((action === "edit" || action === "arm") && (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error("expectedRevision must be a nonnegative safe integer.");
    const service = purchaseService();
    return Response.json(action === "edit" ? await service.editDraft(id, input, expectedRevision as number) : await service.action(id, action, action === "arm" ? expectedRevision as number : undefined));
  } catch (error) {
    if (error instanceof RevisionConflictError) return Response.json({ error: error.message }, { status: 409 });
    return errorResponse(error);
  }
}
