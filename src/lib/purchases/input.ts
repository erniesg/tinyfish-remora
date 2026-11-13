import type { MandateInput } from "./types";

export function validateInput(value: unknown): MandateInput {
  if (!value || typeof value !== "object") throw new Error("A bounded purchase input is required.");
  const x = value as Record<string, unknown>;
  for (const key of ["instrumentId", "accountId", "timezone", "scheduledAt", "expiresAt"]) if (typeof x[key] !== "string" || !x[key]) throw new Error(`${key} is required.`);
  if (!["schedule", "opening", "first-trade"].includes(String(x.trigger)) || x.session !== "regular") throw new Error("Only schedule/opening/first-trade and regular-session limit orders are supported.");
  for (const key of ["shares", "limitPrice", "maxSpend", "buffer"]) if (typeof x[key] !== "number" || !Number.isFinite(x[key]) || Number(x[key]) < (key === "buffer" ? 0 : 0.01)) throw new Error(`${key} must be a finite positive number (buffer may be zero).`);
  if (!Number.isSafeInteger(x.shares) || Number(x.shares) > 1000000) throw new Error("Use integer shares, at most 1000000; fractional/notional orders are unsupported.");
  if (Number(x.limitPrice) > 100000000 || Number(x.maxSpend) > 100000000 || Number(x.buffer) > 100000000) throw new Error("Money values exceed supported bounds.");
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(x.scheduledAt)) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(x.expiresAt))) throw new Error("Times must be ISO instants with an explicit offset; timezone is separately required.");
  const start = Date.parse(String(x.scheduledAt)), end = Date.parse(String(x.expiresAt));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Expiry must follow a valid scheduled instant.");
  try { new Intl.DateTimeFormat("en", { timeZone: String(x.timezone) }).format(); } catch { throw new Error("A valid IANA timezone is required."); }
  return { instrumentId: String(x.instrumentId), accountId: String(x.accountId), trigger: x.trigger as MandateInput["trigger"], session: "regular", timezone: String(x.timezone), scheduledAt: new Date(start).toISOString(), expiresAt: new Date(end).toISOString(), shares: Number(x.shares), limitPrice: Number(x.limitPrice), maxSpend: Number(x.maxSpend), buffer: Number(x.buffer) };
}
