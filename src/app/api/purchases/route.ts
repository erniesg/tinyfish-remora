import { errorResponse, guardMutation, mutationEnabled, purchaseService, requestBody } from "@/lib/purchases/server";
import { preview, validateInput } from "@/lib/purchases/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await purchaseService().dashboard(mutationEnabled()), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    guardMutation(request);
    const body = await requestBody(request), service = purchaseService();
    if (body.action === "preview") return Response.json(preview(validateInput(body.input)));
    if (body.action === "create") return Response.json(await service.create(body.input), { status: 201 });
    if (body.action === "kill" && typeof body.enabled === "boolean") { await service.kill(body.enabled); return Response.json(await service.dashboard(true)); }
    throw new Error("Use preview, create, or kill action.");
  } catch (error) { return errorResponse(error); }
}
