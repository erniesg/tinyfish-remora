import { buildRunTimeline } from "@/lib/demo/engine";

export const dynamic = "force-dynamic";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const url = new URL(request.url);
  const recipeId = url.searchParams.get("recipeId") || "ndrc-policy-lag";
  const strategyId = url.searchParams.get("strategyId") || "strategy-mandarin-lag";
  const mode = (url.searchParams.get("mode") as "paper" | "live" | null) || "paper";
  const timeline = buildRunTimeline({
    runId,
    recipeId,
    strategyId,
    mode,
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for (const event of timeline) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        await sleep(event.delayMs);
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
