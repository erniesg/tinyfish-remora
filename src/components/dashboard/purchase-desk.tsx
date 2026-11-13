"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MandateInput, Preview, Purchase, PurchaseDashboard, Trigger } from "@/lib/purchases/types";

const triggerNames: Record<Trigger, string> = { schedule: "At a chosen time", opening: "At a regular opening", "first-trade": "When a new listing starts trading" };
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-SG", { style: "currency", currency }).format(amount);
const when = (value: string, timezone: string) => new Date(value).toLocaleString("en-SG", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });

// Reject nonexistent and repeated local times rather than silently choosing a DST offset.
export function localInstant(local: string, timezone: string): string {
  const wall = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(wall)) throw new Error("Choose a valid date and time.");
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let instant = wall;
  for (let n = 0; n < 4; n++) {
    const shown = Date.parse(fmt.format(new Date(instant)).replace(" ", "T") + ":00Z");
    instant += wall - shown;
  }
  const matches = (time: number) => fmt.format(new Date(time)).replace(" ", "T") === local;
  if (!matches(instant) || matches(instant - 3600000) || matches(instant + 3600000)) throw new Error("This local time is skipped or repeated by daylight saving. Choose another time.");
  return new Date(instant).toISOString();
}

export function PurchaseDesk() {
  const [data, setData] = useState<PurchaseDashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusStale, setStatusStale] = useState(false);
  const [instrumentId, setInstrument] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("schedule");
  const [timezone, setTimezone] = useState("Asia/Singapore");
  const [scheduledAt, setScheduled] = useState("");
  const [expiresAt, setExpiry] = useState("");
  const [shares, setShares] = useState("1");
  const [limitPrice, setLimit] = useState("");
  const [maxSpend, setMax] = useState("");
  const buffer = 5; // Conservative fixture reserve, not an estimate of IBKR's actual fees.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState<MandateInput | null>(null);
  const [message, setMessage] = useState("");
  const refreshVersion = useRef(0);
  const appliedRefreshVersion = useRef(0);

  async function request<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Purchase service unavailable. Your saved purchases have not been changed.");
    return result as T;
  }
  async function load() {
    const version = ++refreshVersion.current;
    let next: PurchaseDashboard;
    try { next = await request<PurchaseDashboard>("/api/purchases"); }
    catch (e) { if (version >= appliedRefreshVersion.current) throw e; return; }
    if (version < appliedRefreshVersion.current) return;
    appliedRefreshVersion.current = version;
    setData(next);
    setStatusStale(false);
    setInstrument(current => current || next.catalog[0]?.id || "");
  }
  useEffect(() => {
    load().catch(e => setError(e.message));
    const timer = window.setInterval(() => { load().catch(() => setStatusStale(true)); }, 5000);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const instrument = data?.catalog.find(item => item.id === instrumentId);
  const currency = instrument?.currency || "USD";
  const committed = data?.purchases.filter(p => p.instrumentSnapshot.currency === currency).reduce((sum, p) => sum + p.spent + p.reserved, 0) || 0;
  const availableCash = Math.max(0, (data?.account.cashBalances[currency] || 0) - committed);
  function changed() { setPreview(null); setReviewed(null); setMessage(""); }
  async function act(operation: () => Promise<void>) {
    setBusy(true); setError("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed. Try again."); }
    finally { setBusy(false); }
  }
  async function review(event: React.FormEvent) {
    event.preventDefault();
    await act(async () => {
      const input: MandateInput = { instrumentId, accountId: data!.account.id, trigger, scheduledAt: localInstant(scheduledAt, timezone), timezone, session: "regular", shares: Number(shares), limitPrice: Number(limitPrice), maxSpend: Number(maxSpend), buffer, expiresAt: localInstant(expiresAt, timezone) };
      setPreview(await request<Preview>("/api/purchases", { action: "preview", input })); setReviewed(input);
    });
  }
  async function purchaseAction(purchase: Purchase, action: string) {
    await act(async () => { await request(`/api/purchases/${purchase.id}`, { action }); await load(); setMessage(action === "arm" ? "Simulation armed. Scheduling checks revalidate the saved limits before submission." : "Purchase status updated."); });
  }

  return <main className="mx-auto max-w-6xl px-5 py-8 md:px-10">
    <nav className="mb-10 flex items-center justify-between gap-4" aria-label="Purchase navigation"><Link href="/dashboard" className="nav-link">← Cockpit</Link><span className="text-sm text-[var(--muted)]">REMORA / IBKR</span></nav>
    <header className="mb-8"><p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">Public shares</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Plan a share purchase</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Choose a listing, set a price and spending ceiling, then arm a bounded purchase. No promise of the first price or a fill.</p></header>
    <aside className="mb-7 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"><strong>Local simulation — no real orders.</strong> Listing, account and fill evidence below is mocked, not IBKR paper or live evidence. Live activation is unavailable.</aside>
    {error && <div role="alert" className="mb-5 rounded-2xl border border-rose-300/40 p-4 text-rose-200">{error} <button className="underline" onClick={() => act(load)} disabled={busy}>Reload saved purchases</button></div>}
    {statusStale && <p role="alert" className="mb-5 text-amber-100">Status refresh unavailable. This is the last saved view, not current execution confirmation. <button className="underline" disabled={busy} onClick={() => act(load)}>Retry status</button></p>}
    {message && <p role="status" className="mb-5 text-emerald-200">{message}</p>}
    {!data ? <p role="status">{error ? "Purchase data could not be loaded." : "Loading account and saved purchases…"}</p> : <>
      <section aria-labelledby="account-heading" className="mb-7 rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="account-heading" className="text-lg font-semibold">Purchase account</h2><p className="mt-2 text-[var(--muted)]">{data.account.id} · {money(availableCash, currency)} unreserved for this listing · {currency} cash only</p></div><span className="rounded-full border border-[var(--line)] px-3 py-1 text-sm">{data.mutationEnabled ? "Simulation available" : "Setup required"}</span></div>
        {data.account.reasons.map(reason => <p key={reason} className="mt-2 text-sm text-amber-100">{reason}</p>)}
        <div className="mt-4 border-t border-[var(--line)] pt-4 text-sm" role="status"><p>{!statusStale && data.scheduler?.checkedRecently ? "Scheduling checks observed recently." : "Scheduling checks unavailable. Purchases stay saved, but unattended submission is not currently confirmed."}</p><p className="mt-1 text-[var(--muted)]">{data.scheduler?.lastCheckAt ? `Last check: ${when(data.scheduler.lastCheckAt, timezone)} (${timezone}). A recent check is not a guarantee of future execution.` : "No scheduling check observed yet."}</p>{(!data.scheduler?.checkedRecently || statusStale) && <button className="mt-2 underline" disabled={busy} onClick={() => act(load)}>Retry scheduling status</button>}</div>
        <details className="mt-3 text-sm text-[var(--muted)]"><summary className="cursor-pointer">Account and simulation limitations</summary>{data.notices.map(notice => <p key={notice} className="mt-2">{notice}</p>)}</details>
        {data.killSwitch && <p className="mt-3 text-amber-100">All mandates stopped. Submitted orders await confirmed cancellation. Resuming permits new mandates only; revoked purchases stay stopped.</p>}
      </section>
      <div className="grid gap-7 lg:grid-cols-[1.05fr_1fr]">
        <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6"><h2 className="text-xl font-semibold">Set purchase limits</h2>
          <form onSubmit={review} onChange={changed} className="mt-5"><fieldset disabled={busy} className="space-y-5">
            <div className="text-sm"><label htmlFor="purchase-listing">Company and listing</label><select id="purchase-listing" className="input-shell mt-2" value={instrumentId} onChange={e => { setInstrument(e.target.value); setLimit(""); setMax(""); }} required>{data.catalog.map(item => <option key={item.id} value={item.id}>{item.issuer} · {item.symbol || "Listing unconfirmed"} · {item.exchange} · {item.currency}</option>)}</select></div>
            {instrument && <div className="text-sm text-[var(--muted)]"><p>{instrument.shareClass} · {instrument.exchange} · {instrument.currency}</p>{instrument.reasons.map(reason => <p key={reason} className="mt-1 text-amber-100">{reason}</p>)}</div>}
            <div className="text-sm"><label htmlFor="purchase-trigger">When to buy</label><select id="purchase-trigger" className="input-shell mt-2" value={trigger} onChange={e => setTrigger(e.target.value as Trigger)}>{Object.entries(triggerNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></div>
            <p className="text-sm text-[var(--muted)]">{trigger === "first-trade" ? "Wait for verified listing and market-open evidence, not just the announced IPO date." : trigger === "opening" ? "Submit after regular trading is confirmed open in the selected exchange session. Submission can be delayed; this is not an opening-auction order." : "Submit only during the approved regular session at or after your chosen time."} Limit orders only; no later-session or market-order fallback.</p>
            <div className="text-sm"><label htmlFor="purchase-timezone">Timezone</label><select id="purchase-timezone" className="input-shell mt-2" value={timezone} onChange={e => setTimezone(e.target.value)}>{["Asia/Singapore", "America/New_York", "Europe/London", "Asia/Hong_Kong"].map(zone => <option key={zone}>{zone}</option>)}</select></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">{trigger === "schedule" ? "Purchase after" : "Start watching after"}<input className="input-shell mt-2" type="datetime-local" value={scheduledAt} onChange={e => setScheduled(e.target.value)} required /></label><label className="block text-sm">Stop if unfilled by<input className="input-shell mt-2" type="datetime-local" value={expiresAt} onChange={e => setExpiry(e.target.value)} required /></label></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Whole shares<input className="input-shell mt-2" type="number" min="1" step="1" value={shares} onChange={e => setShares(e.target.value)} required /></label><label className="block text-sm">Limit per share ({currency})<input className="input-shell mt-2" type="number" min="0.01" step="0.01" value={limitPrice} onChange={e => setLimit(e.target.value)} required /></label><label className="block text-sm">Total spending ceiling ({currency})<input className="input-shell mt-2" type="number" min="0.01" step="0.01" value={maxSpend} onChange={e => setMax(e.target.value)} required /></label><div className="text-sm"><p>Simulation fee reserve</p><p className="mt-3">{money(buffer, currency)}</p><p className="mt-1 text-xs text-[var(--muted)]">Fixed conservative fixture bound, not an IBKR fee quote. Actual fees must be verified before broker execution.</p></div></div>
            <p className="text-sm text-[var(--muted)]">The ceiling includes the fee reserve. No borrowing, automatic currency conversion or fractional shares. Orders never roll into a later exchange session.</p>
            <button className="primary-button" disabled={busy || !data.mutationEnabled}>{busy ? "Working…" : "Preview purchase"}</button>
          </fieldset></form>
        </section>
        <div className="space-y-7">
          <section aria-labelledby="preview-heading" className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6"><h2 id="preview-heading" className="text-xl font-semibold">Purchase preview</h2>
            {!preview || !reviewed ? <p className="mt-4 text-[var(--muted)]">Your listing, timing and maximum cost will appear here before you save or arm anything.</p> : <div className="mt-4 space-y-4" aria-live="polite"><p className="text-lg">{reviewed.shares} × {preview.instrument?.issuer || "Unconfirmed listing"}</p><dl className="grid grid-cols-2 gap-3 text-sm"><dt className="text-[var(--muted)]">Account / mode</dt><dd>{reviewed.accountId} · simulation</dd><dt className="text-[var(--muted)]">Listing</dt><dd>{preview.instrument?.exchange} · {preview.instrument?.shareClass} · {preview.instrument?.currency || currency}</dd><dt className="text-[var(--muted)]">Limit per share</dt><dd>{money(reviewed.limitPrice, preview.instrument?.currency || currency)}</dd><dt className="text-[var(--muted)]">Maximum cost + reserve</dt><dd>{money(preview.estimatedMaximum, preview.instrument?.currency || currency)}</dd><dt className="text-[var(--muted)]">Spending ceiling</dt><dd>{money(reviewed.maxSpend, preview.instrument?.currency || currency)}</dd><dt className="text-[var(--muted)]">Start / stop</dt><dd>{when(reviewed.scheduledAt, reviewed.timezone)} — {when(reviewed.expiresAt, reviewed.timezone)} ({reviewed.timezone})</dd></dl>
              <p className="text-sm text-[var(--muted)]">Exchange time: {when(reviewed.scheduledAt, preview.instrument?.timezone || timezone)} ({preview.instrument?.timezone || timezone}). At expiry, cancel any remaining shares; partial fills remain purchased.</p>
              <p className={preview.supported ? "text-emerald-200" : "text-amber-100"}>{preview.supported ? "Within the simulation's supported limits." : "This purchase cannot be armed yet."}</p>{preview.reasons.map(reason => <p key={reason} className="text-sm text-amber-100">{reason}</p>)}
              <button className="primary-button" disabled={busy} onClick={() => act(async () => { await request<Purchase>("/api/purchases", { action: "create", input: reviewed }); await load(); setPreview(null); setReviewed(null); setMessage("Purchase saved, not armed. Review it below before authorising simulation."); })}>Save purchase</button>
            </div>}
          </section>
          <details className="rounded-3xl border border-[var(--line)] p-6 text-sm"><summary className="cursor-pointer">Looking for IPO allocation?</summary><p className="mt-3 text-[var(--muted)]">This buys public shares after verified tradability. IPO subscriptions depend on the offering and your account; API subscription support is not verified. Check available offerings in IBKR Portal. Ineligible allocation does not prevent supported public-market purchases.</p></details>
        </div>
      </div>
      <section className="mt-9" aria-labelledby="saved-heading"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 id="saved-heading" className="text-2xl font-semibold">Saved purchases</h2><div className="flex flex-wrap gap-3"><button className="secondary-button" disabled={busy} onClick={() => act(load)}>Refresh status</button><button className="secondary-button" disabled={busy || !data.mutationEnabled} onClick={() => act(async () => { await request<PurchaseDashboard>("/api/purchases", { action: "kill", enabled: !data.killSwitch }); await load(); })}>{data.killSwitch ? "Allow new purchases" : "Stop all purchases"}</button></div></div>
        <p className="mb-4 text-sm text-[var(--muted)]">Stop all purchases permanently revokes armed mandates and requests cancellation of submitted orders. It does not undo fills. Refresh only retrieves status; it never submits an order.</p>
        {!data.purchases.length && <p className="rounded-3xl border border-[var(--line)] p-6 text-[var(--muted)]">No saved purchases. Preview and save a bounded purchase above.</p>}
        <div className="space-y-4">{data.purchases.map(purchase => { const item = purchase.instrumentSnapshot; const ccy = item?.currency || "USD"; const working = ["submitted", "partially-filled", "reconciliation-required", "cancellation-pending"].includes(purchase.state); const terminal = ["filled", "cancelled", "expired", "revoked"].includes(purchase.state); return <article key={purchase.id} className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-6">
          <div className="flex flex-wrap justify-between gap-3"><h3 className="text-lg font-semibold">{purchase.shares} × {item?.issuer || purchase.instrumentId}</h3><span className="rounded-full border border-[var(--line)] px-3 py-1 text-sm capitalize">{purchase.state.replaceAll("-", " ")}</span></div>
          <p className="mt-3 text-sm text-[var(--muted)]">{triggerNames[purchase.trigger]} · {when(purchase.scheduledAt, purchase.timezone)} · {purchase.timezone}</p><p className="mt-2 text-sm">Limit {money(purchase.limitPrice, ccy)} / share · ceiling {money(purchase.maxSpend, ccy)} · {purchase.filledShares} filled · {money(purchase.spent, ccy)} spent</p><p className="mt-2 text-sm text-[var(--muted)]">Stop by {when(purchase.expiresAt, purchase.timezone)}. Cancel remaining shares at expiry or revocation; cancellation requires confirmation.</p>
          {purchase.reasons.map(reason => <p key={reason} className="mt-3 text-sm text-amber-100">{reason}</p>)}
          <div className="mt-4 flex flex-wrap gap-3">{!terminal && !working && <button className="primary-button" disabled={busy || data.killSwitch || !data.mutationEnabled || !["draft", "blocked"].includes(purchase.state)} onClick={() => purchaseAction(purchase, "arm")}>Arm simulation</button>}{!terminal && <button className="secondary-button" disabled={busy || !data.mutationEnabled} onClick={() => purchaseAction(purchase, working ? "cancel" : "revoke")}>{working ? "Cancel remaining shares" : "Revoke purchase"}</button>}{working && <button className="secondary-button" disabled={busy || !data.mutationEnabled} onClick={() => purchaseAction(purchase, "refresh")}>Check broker evidence</button>}</div>
          <details className="mt-5 text-sm"><summary className="cursor-pointer text-[var(--muted)]">Order details and evidence</summary><dl className="mt-3 grid grid-cols-2 gap-2"><dt>Purchase</dt><dd className="break-all">{purchase.id}</dd><dt>Contract</dt><dd>{item?.conid || "Unresolved"} · {item?.exchange} · {item?.shareClass}</dd><dt>Account</dt><dd>{purchase.accountId}</dd><dt>Order</dt><dd>{purchase.brokerOrderId || "Not acknowledged"}</dd><dt>Risk reserved</dt><dd>{money(purchase.reserved, ccy)}</dd></dl>{purchase.executions?.length > 0 && <div className="mt-4"><h4 className="font-semibold">Individual fills</h4><ul className="mt-2 space-y-2">{purchase.executions.map(fill => <li key={fill.id}><p>{fill.quantity} × {money(fill.price, fill.currency)} · fee {fill.fee === null ? "not confirmed" : money(fill.fee, fill.currency)}</p><p className="break-all text-xs text-[var(--muted)]">Execution {fill.id}</p></li>)}</ul></div>}<ol className="mt-4 space-y-2">{purchase.receipts.map((receipt, index) => <li key={index}>{when(receipt.at, purchase.timezone)} · {receipt.evidence} · {receipt.kind}: {receipt.message}</li>)}</ol></details>
        </article>; })}</div>
      </section>
    </>}
  </main>;
}
