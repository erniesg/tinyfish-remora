import type { DemoUser, RiskProfile } from "@/lib/demo/types";

export interface DemoAccount extends DemoUser {
  passcode: string;
  createdAt: string;
  lastUsedAt: string;
}

export const DEMO_SESSION_KEY = "tinyfish-remora-user";
export const DEMO_ACCOUNTS_KEY = "tinyfish-remora-demo-accounts";

interface CreateDemoAccountInput {
  name: string;
  email: string;
  company?: string;
  riskProfile: RiskProfile;
  passcode: string;
}

interface SignInDemoAccountInput {
  email: string;
  passcode: string;
}

const SEEDED_ACCOUNTS: DemoAccount[] = [
  {
    id: "demo-ernie",
    name: "Ernie Demo",
    email: "ernie@tinyfish.demo",
    company: "TinyFish Labs",
    riskProfile: "balanced",
    passcode: "2468",
    createdAt: "2026-03-28T00:00:00.000Z",
    lastUsedAt: "2026-03-28T00:00:00.000Z",
  },
  {
    id: "demo-macro",
    name: "Macro Desk",
    email: "macro@tinyfish.demo",
    company: "East Channel Capital",
    riskProfile: "conservative",
    passcode: "1357",
    createdAt: "2026-03-28T00:00:00.000Z",
    lastUsedAt: "2026-03-28T00:00:00.000Z",
  },
];

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback;

  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function toSessionUser(account: DemoAccount): DemoUser {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    company: account.company,
    riskProfile: account.riskProfile,
  };
}

function sortAccounts(accounts: DemoAccount[]): DemoAccount[] {
  return [...accounts].sort((left, right) => {
    return new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime();
  });
}

export function readDemoSession(): DemoUser | null {
  return readJson<DemoUser | null>(DEMO_SESSION_KEY, null);
}

export function clearDemoSession(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(DEMO_SESSION_KEY);
}

export function ensureDemoAccounts(): DemoAccount[] {
  const accounts = readJson<DemoAccount[]>(DEMO_ACCOUNTS_KEY, []);
  if (accounts.length > 0) {
    return sortAccounts(accounts);
  }

  writeJson(DEMO_ACCOUNTS_KEY, SEEDED_ACCOUNTS);
  return SEEDED_ACCOUNTS;
}

export function createDemoAccount(input: CreateDemoAccountInput): DemoUser {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const company = input.company?.trim();
  const passcode = input.passcode.trim();

  if (!name) throw new Error("Enter a name to create the demo account.");
  if (!email.includes("@")) throw new Error("Enter a valid email address.");
  if (passcode.length < 4) throw new Error("Use a 4+ digit local passcode.");

  const accounts = ensureDemoAccounts();
  if (accounts.some((account) => normalizeEmail(account.email) === email)) {
    throw new Error("That demo account already exists on this device.");
  }

  const timestamp = new Date().toISOString();
  const account: DemoAccount = {
    id: makeId("user"),
    name,
    email,
    company,
    riskProfile: input.riskProfile,
    passcode,
    createdAt: timestamp,
    lastUsedAt: timestamp,
  };

  const nextAccounts = sortAccounts([account, ...accounts]);
  writeJson(DEMO_ACCOUNTS_KEY, nextAccounts);
  writeJson(DEMO_SESSION_KEY, toSessionUser(account));
  return toSessionUser(account);
}

export function signInDemoAccount(input: SignInDemoAccountInput): DemoUser {
  const email = normalizeEmail(input.email);
  const passcode = input.passcode.trim();
  const accounts = ensureDemoAccounts();
  const account = accounts.find((entry) => normalizeEmail(entry.email) === email);

  if (!account || account.passcode !== passcode) {
    throw new Error("Email or passcode did not match a local demo account.");
  }

  const nextAccount: DemoAccount = {
    ...account,
    lastUsedAt: new Date().toISOString(),
  };
  const nextAccounts = sortAccounts([
    nextAccount,
    ...accounts.filter((entry) => entry.id !== account.id),
  ]);

  writeJson(DEMO_ACCOUNTS_KEY, nextAccounts);
  writeJson(DEMO_SESSION_KEY, toSessionUser(nextAccount));
  return toSessionUser(nextAccount);
}

export function resumeDemoAccount(accountId: string): DemoUser {
  const accounts = ensureDemoAccounts();
  const account = accounts.find((entry) => entry.id === accountId);

  if (!account) {
    throw new Error("That local demo account is no longer available.");
  }

  const nextAccount: DemoAccount = {
    ...account,
    lastUsedAt: new Date().toISOString(),
  };
  const nextAccounts = sortAccounts([
    nextAccount,
    ...accounts.filter((entry) => entry.id !== account.id),
  ]);

  writeJson(DEMO_ACCOUNTS_KEY, nextAccounts);
  writeJson(DEMO_SESSION_KEY, toSessionUser(nextAccount));
  return toSessionUser(nextAccount);
}
