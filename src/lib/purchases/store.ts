import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Purchase } from "./types";
import type { BrokerOrder } from "./broker";
import { validateDatabase } from "./validation";

export class PurchaseStoreBusyError extends Error {
  constructor(age: number) { super(`Purchase store locked (${Math.round(age / 1000)}s). Stop workers and reconcile before manually removing a stale lock.`); this.name = "PurchaseStoreBusyError"; }
}

export interface Database { version: 1; killSwitch: boolean; purchases: Purchase[]; mockOrders: Record<string, BrokerOrder>; lastCheckAt?: string }
export interface Transaction { data: Database; save(): Promise<void> }
export class PurchaseStore {
  constructor(readonly filename: string) {
    if (!path.isAbsolute(filename)) throw new Error("REMORA_PURCHASE_STORE must be an absolute private path.");
    const relative = path.relative(process.cwd(), filename);
    if (!relative.startsWith(`..${path.sep}`) && relative !== "..") throw new Error("Purchase storage must be outside the project and public directory.");
  }
  async load(): Promise<Database> {
    try {
      const data = JSON.parse(await readFile(this.filename, "utf8")) as Database;
      validateDatabase(data);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, killSwitch: false, purchases: [], mockOrders: {} };
      throw error;
    }
  }
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const parent = path.dirname(this.filename);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    // Refuse symlinked storage: the private path must not redirect into a public tree.
    const { realpath, lstat } = await import("node:fs/promises");
    if (await realpath(parent) !== parent) throw new Error("Storage parent must be a canonical private path.");
    try { if ((await lstat(this.filename)).isSymbolicLink()) throw new Error("Symlinked purchase storage is forbidden."); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const lock = `${this.filename}.lock`;
    try { await mkdir(lock, { mode: 0o700 }); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        const age = await stat(lock).then(s => Date.now() - s.mtimeMs).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; });
        throw new PurchaseStoreBusyError(age);
      }
      throw e;
    }
    try {
      const data = await this.load();
      const save = async () => {
        validateDatabase(data);
        const temp = `${this.filename}.${randomUUID()}.tmp`;
        const file = await open(temp, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
        await rename(temp, this.filename);
        const dir = await open(parent, "r");
        try { await dir.sync(); } finally { await dir.close(); }
      };
      const result = await fn({ data, save });
      await save();
      return result;
    } finally { await rm(lock, { recursive: true }); }
  }
}
