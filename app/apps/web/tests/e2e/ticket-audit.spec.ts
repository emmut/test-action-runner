import { expect, test } from "@playwright/test";
import { STORAGE_STATE, unique } from "./helpers";
import { AUDIT_BATCH, seedTickets } from "./seed";
import { addNote, assign, openTicket, triage } from "./tickets";

test.use({ storageState: STORAGE_STATE });

test("actions from a flow appear in the audit log", async ({ page }, info) => {
  const batch = unique(info, "e2e-auditflow");
  const [t] = await seedTickets(batch, 1);
  await openTicket(page, t!.id);
  await triage(page, "bug", "high");
  await assign(page, "Audit Agent");
  await addNote(page, "first note");
  await addNote(page, "second note");
  await page.goto(`/audit?batch=${batch}`);
  await expect(page.getByText("4 events", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr td:nth-child(1)")).toHaveText(["noted", "noted", "assigned", "triaged"]);
  await expect(page.locator("tbody tr td:nth-child(4)").first()).toHaveText("Shared User");
  await page.getByRole("link", { name: t!.title }).first().click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${t!.id}$`));
});

test("filter audit log by action", async ({ page }) => {
  await page.goto(`/audit?batch=${AUDIT_BATCH}`);
  await expect(page.getByText("150 events", { exact: true })).toBeVisible();
  for (const action of ["noted", "resolved", "reopened"]) {
    await page.getByLabel("Action filter").selectOption(action);
    await expect(page.getByText("30 events", { exact: true })).toBeVisible();
    await expect
      .poll(async () => new Set(await page.locator("tbody tr td:nth-child(1)").allTextContents()))
      .toEqual(new Set([action]));
  }
});

test("paginate the audit log", async ({ page }) => {
  await page.goto(`/audit?batch=${AUDIT_BATCH}`);
  await expect(page.getByText("Page 1 of 8")).toBeVisible();
  for (let p = 2; p <= 8; p++) {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(`Page ${p} of 8`)).toBeVisible();
  }
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(20);
});
