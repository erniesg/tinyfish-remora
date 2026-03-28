import "server-only";

interface RuntimePostOptions {
  bearerToken?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  sharedSecret?: string;
  accept?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function extractEventData(text: string): string[] {
  const events: string[] = [];

  for (const chunk of text.split(/\n\n+/)) {
    const dataLines = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""));

    if (dataLines.length > 0) {
      events.push(dataLines.join("\n"));
    }
  }

  return events;
}

function coerceArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  const candidateKeys = [
    "signals",
    "signal",
    "result",
    "results",
    "data",
    "items",
    "reviewedSignals",
    "reviews",
    "output",
    "outputs",
  ];

  for (const key of candidateKeys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

async function readRuntimeResponse(response: Response): Promise<unknown[]> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Runtime request to ${response.url} failed with ${response.status}: ${text.slice(0, 240)}`,
    );
  }

  if (contentType.includes("text/event-stream")) {
    return extractEventData(text)
      .map((event) => parseMaybeJson(event))
      .filter((event): event is unknown => event !== undefined);
  }

  const json = parseMaybeJson(text);
  if (json !== undefined) {
    const arrayPayload = coerceArrayPayload(json);
    if (arrayPayload.length > 0) {
      return arrayPayload;
    }

    if (json && typeof json === "object") {
      return [json];
    }
  }

  const sseEvents = extractEventData(text)
    .map((event) => parseMaybeJson(event))
    .filter((event): event is unknown => event !== undefined);
  if (sseEvents.length > 0) {
    return sseEvents;
  }

  throw new Error(`Runtime request to ${response.url} returned a non-JSON response`);
}

export async function postRuntimeJson<T>(
  url: string,
  body: unknown,
  options: RuntimePostOptions = {},
): Promise<T> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: options.accept ?? "application/json",
    ...options.headers,
  });

  if (options.bearerToken) {
    headers.set("Authorization", `Bearer ${options.bearerToken}`);
  }

  if (options.apiKey && options.apiKeyHeader) {
    headers.set(options.apiKeyHeader, options.apiKey);
  }

  if (options.sharedSecret) {
    headers.set("x-trading-gateway-secret", options.sharedSecret);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });

  const records = await readRuntimeResponse(response);
  const first = records[0];
  if (first === undefined) {
    throw new Error(`Runtime request to ${url} returned an empty response`);
  }

  return first as T;
}

export async function postRuntimeRecords<T>(
  url: string,
  body: unknown,
  options: RuntimePostOptions = {},
): Promise<T[]> {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: options.accept ?? "text/event-stream, application/json",
    ...options.headers,
  });

  if (options.bearerToken) {
    headers.set("Authorization", `Bearer ${options.bearerToken}`);
  }

  if (options.apiKey && options.apiKeyHeader) {
    headers.set(options.apiKeyHeader, options.apiKey);
  }

  if (options.sharedSecret) {
    headers.set("x-trading-gateway-secret", options.sharedSecret);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  return (await readRuntimeResponse(response)) as T[];
}
