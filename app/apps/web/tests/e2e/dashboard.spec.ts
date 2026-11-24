import { expect, test } from "@playwright/test";
import { STORAGE_STATE } from "./helpers";

test.use({ storageState: STORAGE_STATE });

test("shows user and private tRPC data", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Welcome Shared User")).toBeVisible();
  await expect(page.getByText("API: This is private")).toBeVisible();
});

test("session survives reload", async ({ page }) => {
  await page.goto("/dashboard");
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Shared User" })).toBeVisible();
});
