import { expect, test } from "@playwright/test";

test("home reports API connected", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
});

test("header navigates between pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Todos" }).click();
  await expect(page).toHaveURL(/\/todos$/);
  await expect(page.getByText("Todo List")).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
