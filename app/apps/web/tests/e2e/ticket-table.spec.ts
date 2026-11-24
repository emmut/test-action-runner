import { expect, test } from "@playwright/test";
import { STORAGE_STATE } from "./helpers";
import { TABLE_BATCH, TABLE_SIZE } from "./seed";
import { COL, column, openTable } from "./tickets";

test.use({ storageState: STORAGE_STATE });

const BATCH = `?batch=${TABLE_BATCH}`;
const PAGES = Math.ceil(TABLE_SIZE / 25);

const sorted = (xs: string[], dir: 1 | -1) => xs.every((x, i) => i === 0 || dir * xs[i - 1]!.localeCompare(x) <= 0);

test("first page shows 25 rows and totals", async ({ page }) => {
  await openTable(page, BATCH);
  await expect(page.getByText(`${TABLE_SIZE} tickets`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Page 1 of ${PAGES}`)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
});

test("paginate forward and back", async ({ page }) => {
  await openTable(page, BATCH);
  const firstIds: string[] = [];
  for (let p = 2; p <= 6; p++) {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(`Page ${p} of ${PAGES}`)).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(25);
    firstIds.push((await column(page, COL.id))[0]!);
  }
  expect(new Set(firstIds).size).toBe(5);
  for (let p = 5; p >= 3; p--) {
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText(`Page ${p} of ${PAGES}`)).toBeVisible();
  }
  await expect(page).toHaveURL(/page=3/);
});

test("sort by title both directions", async ({ page }) => {
  await openTable(page, BATCH);
  const header = page.getByRole("columnheader", { name: "Title" });
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(async () => sorted(await column(page, COL.title), 1)).toBe(true);
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect.poll(async () => sorted(await column(page, COL.title), -1)).toBe(true);
  await page.getByRole("button", { name: "Next" }).click();
  await expect.poll(async () => sorted(await column(page, COL.title), -1)).toBe(true);
});

test("sort by priority puts urgent first", async ({ page }) => {
  await openTable(page, BATCH);
  const button = page.getByRole("columnheader", { name: "Priority" }).getByRole("button");
  await button.click();
  await expect.poll(async () => new Set(await column(page, COL.priority))).toEqual(new Set(["low"]));
  await button.click();
  await expect.poll(async () => new Set(await column(page, COL.priority))).toEqual(new Set(["urgent"]));
});

test("filter by status", async ({ page }) => {
  await openTable(page, BATCH);
  for (const status of ["resolved", "triaged", "open"]) {
    await page.getByLabel("Status filter").selectOption(status);
    await expect(page.getByText(`${TABLE_SIZE / 4} tickets`, { exact: true })).toBeVisible();
    await expect.poll(async () => new Set(await column(page, COL.status))).toEqual(new Set([status]));
  }
});

test("combine status and priority filters", async ({ page }) => {
  await openTable(page, BATCH);
  await page.getByLabel("Status filter").selectOption("in_progress");
  await page.getByLabel("Priority filter").selectOption("high");
  await expect(page).toHaveURL(/status=in_progress/);
  await expect(page).toHaveURL(/priority=high/);
  await expect.poll(async () => new Set(await column(page, COL.status))).toEqual(new Set(["in_progress"]));
  await expect.poll(async () => new Set(await column(page, COL.priority))).toEqual(new Set(["high"]));
});

test("search by customer", async ({ page }) => {
  await openTable(page, BATCH);
  await page.getByLabel("Search").fill("Globex 17");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=Globex/);
  await expect.poll(async () => (await column(page, COL.customer)).every((c) => c === "Globex 17")).toBe(true);
  await expect.poll(async () => (await column(page, COL.customer)).length).toBeGreaterThan(0);
});

test("table state survives reload", async ({ page }) => {
  await openTable(page, BATCH);
  await page.getByLabel("Priority filter").selectOption("medium");
  await page.getByRole("columnheader", { name: "Customer" }).getByRole("button").click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/^Page 3 of/)).toBeVisible();
  const before = await column(page, COL.id);
  await page.reload();
  await expect(page.getByText(/^Page 3 of/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Customer" })).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => column(page, COL.id)).toEqual(before);
});

test("open a ticket from the table", async ({ page }) => {
  await openTable(page, BATCH);
  const title = (await column(page, COL.title))[3]!;
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`${title}$`) })).toBeVisible();
  await page.getByRole("link", { name: "Back to tickets" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
});
