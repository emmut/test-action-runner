import { expect, test, type Page } from "@playwright/test";
import { unique } from "./helpers";

// Todos are global in the template, so every test only touches its own items.
async function addTodo(page: Page, text: string) {
  await page.getByPlaceholder("Add a new task...").fill(text);
  await page.getByRole("button", { name: "Add" }).click();
  const item = page.getByRole("listitem").filter({ hasText: text });
  await expect(item).toBeVisible();
  return item;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/todos");
  // List/empty state only renders after hydration + tRPC fetch; typing earlier gets wiped by React.
  await expect(page.getByText("No todos yet").or(page.getByRole("listitem").first())).toBeVisible();
});

test("add a todo", async ({ page }, info) => {
  const text = unique(info, "add");
  await addTodo(page, text);
  await expect(page.getByPlaceholder("Add a new task...")).toHaveValue("");
});

test("add button is disabled for blank input", async ({ page }) => {
  const add = page.getByRole("button", { name: "Add" });
  await expect(add).toBeDisabled();
  await page.getByPlaceholder("Add a new task...").fill("   ");
  await expect(add).toBeDisabled();
});

test("complete and reopen a todo", async ({ page }, info) => {
  const text = unique(info, "toggle");
  const item = await addTodo(page, text);
  const box = item.getByRole("checkbox");
  await box.click();
  await expect(box).toBeChecked();
  await expect(item.getByText(text)).toHaveClass(/line-through/);
  await box.click();
  await expect(box).not.toBeChecked();
});

test("delete a todo", async ({ page }, info) => {
  const text = unique(info, "delete");
  const item = await addTodo(page, text);
  await item.getByRole("button", { name: "Delete todo" }).click();
  await expect(item).toHaveCount(0);
});

test("todos persist across reload", async ({ page }, info) => {
  const text = unique(info, "persist");
  const item = await addTodo(page, text);
  await item.getByRole("checkbox").click();
  await expect(item.getByRole("checkbox")).toBeChecked();
  await page.reload();
  const reloaded = page.getByRole("listitem").filter({ hasText: text });
  await expect(reloaded.getByRole("checkbox")).toBeChecked();
});

test("add several todos in a row", async ({ page }, info) => {
  const texts = [1, 2, 3, 4, 5].map((n) => unique(info, `bulk${n}`));
  for (const text of texts) await addTodo(page, text);
  for (const text of texts) {
    await expect(page.getByRole("listitem").filter({ hasText: text })).toBeVisible();
  }
});
