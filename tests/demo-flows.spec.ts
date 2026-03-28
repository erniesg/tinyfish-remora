import { expect, test } from "@playwright/test";

test.describe("tinyfish-remora streamlined demo", () => {
  test("home redirects straight into the workbench", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("dashboard-workbench")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run the scan. Review the signal. Replay the trade." })).toBeVisible();
    await expect(page.getByTestId("launch-run")).toBeVisible();
  });

  test("dashboard can launch a run and show review artifacts", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByTestId("launch-run").click();

    await expect(page.getByTestId("event-ledger").getByText(/complete|blocked/i).first()).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByTestId("raw-signals")).not.toContainText(
      "Raw source hits land here after the collector step.",
    );
    await expect(page.getByTestId("reviewed-signals")).not.toContainText(
      "Reviewed signals and tradeable instrument candidates show up here.",
    );
  });

  test("auth page can load a seeded profile and runs can be replayed from history", async ({
    page,
  }) => {
    await page.goto("/auth");

    await expect(page.getByRole("heading", { name: "Local profiles" })).toBeVisible();
    await page.getByRole("button", { name: "Use profile" }).first().click();
    await expect(page.getByText(/Using .* on this device\./)).toBeVisible();

    await page.getByRole("button", { name: "Enter workbench" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByTestId("launch-run").click();
    await expect(page.getByTestId("event-ledger").getByText(/complete|blocked/i).first()).toBeVisible({
      timeout: 45_000,
    });

    const history = page.getByTestId("run-history");
    await expect(history.getByRole("button", { name: "Replay" }).first()).toBeVisible();
    const initialCount = await history.getByRole("button", { name: "Review" }).count();

    await history.getByRole("button", { name: "Replay" }).first().click();
    await expect
      .poll(async () => history.getByRole("button", { name: "Review" }).count(), {
        timeout: 45_000,
      })
      .toBeGreaterThan(initialCount);
  });
});
