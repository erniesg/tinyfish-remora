import { expect, test, type Page } from "@playwright/test";

async function enterDemoCockpit(page: Page) {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Start in demo mode," })).toBeVisible();

  await page.getByRole("button", { name: /Create demo account|Enter demo cockpit/ }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Brand-first overview cockpit")).toBeVisible();
}

async function waitForRunToComplete(page: Page) {
  await expect(page.getByText("Event ledger", { exact: true })).toBeVisible();
  await expect(page.getByText(/Receipt:/).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("tinyfish-remora Playwright flows", () => {
  test("demo auth entry redirects into dashboard cockpit", async ({ page }) => {
    await enterDemoCockpit(page);

    await expect(page.getByText("Retail investor cockpit")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run Recipe" }).first()).toBeVisible();
  });

  test("dashboard launch can run recipe and stream ledger activity", async ({ page }) => {
    await enterDemoCockpit(page);

    await expect(page.getByText("Streaming ledger")).toBeVisible();
    await page.locator("#launch-section").getByRole("button", { name: "Launch Paper Run" }).click();

    await waitForRunToComplete(page);
    await expect(page.getByText("Run board", { exact: true })).toBeVisible();
    await expect(page.getByText(/Mandarin Policy Lag complete\./).first()).toBeVisible();
  });

  test("ask agent flow generates draft and supports save + paper preview", async ({ page }) => {
    await enterDemoCockpit(page);

    const launchSection = page.locator("#launch-section");
    await launchSection.getByRole("button", { name: "Ask Agent" }).click();

    await launchSection.getByRole("button", { name: "Generate Draft" }).click();

    await expect(launchSection.getByText("Generated run config", { exact: true })).toBeVisible();
    await expect(launchSection.getByRole("button", { name: "Save Draft" })).toBeVisible();

    await launchSection.getByRole("button", { name: "Save Draft" }).click();
    await expect(launchSection.getByText("Awaiting draft")).toBeVisible();

    await launchSection.getByRole("button", { name: "Generate Draft" }).click();
    await expect(launchSection.getByRole("button", { name: "Run Paper Preview" })).toBeVisible();

    await launchSection.getByRole("button", { name: "Run Paper Preview" }).click();

    await waitForRunToComplete(page);
    await expect(page.getByText("Run board", { exact: true })).toBeVisible();
  });
});
