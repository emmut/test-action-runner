import { expect, type Page } from "@playwright/test";

/** Page-object helpers shared by the ticket specs. */

export async function openTable(page: Page, query = "") {
  await page.goto(`/tickets${query}`);
  await expect(page.getByText(/^\d+ tickets$/)).toBeVisible();
}

export async function column(page: Page, n: number) {
  return page.locator(`tbody tr td:nth-child(${n})`).allTextContents();
}

export const COL = { id: 1, title: 2, customer: 3, priority: 4, status: 5 } as const;

export function field(page: Page, name: string) {
  return page.locator(`[data-field="${name}"]`);
}

export async function openTicket(page: Page, id: number) {
  await page.goto(`/tickets/${id}`);
  await expect(page.getByRole("heading", { name: new RegExp(`^Ticket #${id}:`) })).toBeVisible();
}

export async function triage(page: Page, category: string, priority: string) {
  const section = page.getByRole("region", { name: "Triage" });
  await section.getByLabel("Category").selectOption(category);
  await section.getByLabel("Set priority").selectOption(priority);
  await section.getByRole("button", { name: "Save triage" }).click();
  await expect(field(page, "Status")).toHaveText("triaged");
  await expect(field(page, "Category")).toHaveText(category);
}

export async function assign(page: Page, who: string) {
  await page.getByLabel("Assignee").fill(who);
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(field(page, "Status")).toHaveText("in_progress");
  await expect(field(page, "Assignee")).toHaveText(who);
}

export async function addNote(page: Page, body: string) {
  const notes = page.getByRole("region", { name: "Notes" });
  const before = await notes.getByRole("listitem").count();
  await page.getByLabel("Note", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByRole("listitem")).toHaveCount(before + 1);
  await expect(notes.getByRole("listitem").last()).toHaveText(body);
}

export async function resolve(page: Page, resolution: string) {
  await page.getByRole("button", { name: "Resolve" }).click();
  const dialog = page.getByRole("dialog", { name: "Resolve ticket" });
  await dialog.getByLabel("Resolution").fill(resolution);
  await dialog.getByRole("button", { name: "Confirm resolve" }).click();
  await expect(dialog).toBeHidden();
  await expect(field(page, "Status")).toHaveText("resolved");
}

export function history(page: Page) {
  return page.getByRole("region", { name: "History" }).getByRole("listitem");
}
