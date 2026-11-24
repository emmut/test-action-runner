import { expect, test } from "@playwright/test";
import { STORAGE_STATE, unique } from "./helpers";
import { seedTickets } from "./seed";
import { COL, addNote, assign, column, field, history, openTable, openTicket, resolve, triage } from "./tickets";

test.use({ storageState: STORAGE_STATE });

test("full ticket lifecycle", async ({ page }, info) => {
  test.slow();
  const batch = unique(info, "e2e-flow");
  const [t] = await seedTickets(batch, 1);
  await openTicket(page, t!.id);
  await expect(field(page, "Status")).toHaveText("open");
  await triage(page, "billing", "urgent");
  await assign(page, "Alex Agent");
  await addNote(page, "Called the customer, waiting for invoice copy");
  await addNote(page, "Invoice received, duplicate charge confirmed");
  await addNote(page, "Refund issued via payment provider");
  await resolve(page, "Duplicate charge refunded");
  await expect(history(page)).toHaveText([
    "triaged: billing / urgent",
    "assigned: Alex Agent",
    /^noted: Called the customer/,
    /^noted: Invoice received/,
    /^noted: Refund issued/,
    "resolved: Duplicate charge refunded",
  ]);
  await openTable(page, `?batch=${batch}`);
  expect(await column(page, COL.status)).toEqual(["resolved"]);
  expect(await column(page, COL.priority)).toEqual(["urgent"]);
});

test("reopen and resolve again", async ({ page }, info) => {
  const [t] = await seedTickets(unique(info, "e2e-flow"), 1);
  await openTicket(page, t!.id);
  await triage(page, "bug", "high");
  await assign(page, "Sam Support");
  await resolve(page, "Patched in release 1.2");
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(field(page, "Status")).toHaveText("in_progress");
  await expect(field(page, "Resolution")).toHaveText("—");
  await addNote(page, "Regression reported by customer");
  await resolve(page, "Patched again in release 1.3");
  await expect(history(page)).toHaveCount(6);
  await page.reload();
  await expect(field(page, "Resolution")).toHaveText("Patched again in release 1.3");
});

test("cancel resolve and validate resolution", async ({ page }, info) => {
  const [t] = await seedTickets(unique(info, "e2e-flow"), 1);
  await openTicket(page, t!.id);
  await triage(page, "access", "medium");
  await assign(page, "Kim Ops");
  await page.getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve ticket" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(field(page, "Status")).toHaveText("in_progress");
  await page.getByRole("button", { name: "Resolve" }).click();
  await dialog.getByLabel("Resolution").fill("ok");
  await dialog.getByRole("button", { name: "Confirm resolve" }).click();
  await expect(page.getByText("Resolution must be at least 5 characters")).toBeVisible();
  await expect(field(page, "Status")).toHaveText("in_progress");
});

test("assignee is validated", async ({ page }, info) => {
  const [t] = await seedTickets(unique(info, "e2e-flow"), 1);
  await openTicket(page, t!.id);
  await triage(page, "feature", "low");
  await page.getByLabel("Assignee").fill(" x ");
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Assignee must be at least 2 characters")).toBeVisible();
  await expect(field(page, "Status")).toHaveText("triaged");
  await assign(page, "Jo Lead");
});

test("work through a queue of tickets", async ({ page }, info) => {
  test.slow();
  const batch = unique(info, "e2e-queue");
  const tickets = await seedTickets(batch, 6);
  for (const [i, t] of tickets.entries()) {
    await openTable(page, `?batch=${batch}&status=open`);
    await expect(page.getByText(`${tickets.length - i} tickets`, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: t.title }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Ticket #${t.id}:`) })).toBeVisible();
    await triage(page, ["billing", "bug", "access"][i % 3]!, ["low", "high"][i % 2]!);
    await assign(page, `Agent ${i}`);
    await addNote(page, `Investigated issue ${i}`);
    await resolve(page, `Resolved queue item ${i}`);
  }
  await openTable(page, `?batch=${batch}&status=resolved`);
  await expect(page.getByText(`${tickets.length} tickets`, { exact: true })).toBeVisible();
});

test("bulk triage then filter by priority", async ({ page }, info) => {
  test.slow();
  const batch = unique(info, "e2e-triage");
  const tickets = await seedTickets(batch, 10);
  for (const [i, t] of tickets.entries()) {
    await openTicket(page, t.id);
    await triage(page, "other", i < 4 ? "urgent" : "low");
  }
  await openTable(page, `?batch=${batch}&status=triaged&priority=urgent`);
  await expect(page.getByText("4 tickets", { exact: true })).toBeVisible();
  await page.getByLabel("Priority filter").selectOption("low");
  await expect(page.getByText("6 tickets", { exact: true })).toBeVisible();
});
