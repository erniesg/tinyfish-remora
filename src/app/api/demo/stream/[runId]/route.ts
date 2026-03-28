import { parseRunRequestFromUrl } from "@/lib/demo/engine";
import { buildRuntimeRunTimeline } from "@/lib/runtime/orchestrator";

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
  const runRequest = parseRunRequestFromUrl(url);
  const timeline = await buildRuntimeRunTimeline(runId, runRequest);
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
