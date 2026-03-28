import { expect, test } from "@playwright/test";

test.describe("health endpoint", () => {
  test("returns ok even when integration env values are missing", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store, max-age=0");

    const body = (await response.json()) as {
      status: string;
      missingEnv: unknown[];
      missingOptionalEnv: unknown[];
    };

    expect(body.status).toBe("ok");
    expect(Array.isArray(body.missingEnv)).toBe(true);
    expect(Array.isArray(body.missingOptionalEnv)).toBe(true);
  });
});
