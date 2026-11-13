import { mutationEnabled, purchaseService } from "../src/lib/purchases/server";
import { setTimeout } from "node:timers/promises";
import { PurchaseStoreBusyError } from "../src/lib/purchases/store";

// Busy means another transaction owns the lock, not permission to steal it.
export async function workerTick(service: { tick(): Promise<unknown> }): Promise<boolean> {
  try { await service.tick(); return true; }
  catch (error) { if (error instanceof PurchaseStoreBusyError) return false; throw error; }
}

async function main() {
  if (!mutationEnabled()) throw new Error("Worker held. REMORA_PURCHASE_MODE=mock and REMORA_PURCHASE_STORE are required. No broker networking is supported by this worker.");
  const service = purchaseService();
  let stopped = false;
  process.on("SIGTERM", () => { stopped = true; });
  process.on("SIGINT", () => { stopped = true; });
  do {
    const checked = await workerTick(service);
    console.log(JSON.stringify({ evidence: "mock", at: new Date().toISOString(), check: checked ? "completed" : "store-busy-retrying" }));
    if (checked && process.argv.includes("--once")) break;
    if (!stopped) await setTimeout(1000);
  } while (!stopped);
}
if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : "Purchase worker failed."); process.exitCode = 1; });
