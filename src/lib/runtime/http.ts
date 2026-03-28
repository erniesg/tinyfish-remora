import "server-only";

interface RuntimePostOptions {
  bearerToken?: string;
  sharedSecret?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function postRuntimeJson<T>(
  url: string,
  body: unknown,
  options: RuntimePostOptions = {},
): Promise<T> {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...options.headers,
  });

  if (options.bearerToken) {
    headers.set("Authorization", `Bearer ${options.bearerToken}`);
  }

  if (options.sharedSecret) {
    headers.set("x-remora-trading-secret", options.sharedSecret);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  });

  if (!response.ok) {
    throw new Error(`Runtime request to ${url} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}
