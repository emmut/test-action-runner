import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, createUser, unique } from "./helpers";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Already have an account? Sign In" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  // Header also has a "Sign In" button while signed out.
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();
}

test("dashboard redirects anonymous users to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
});

test("sign-up form validates input", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Name").fill("A");
  // Passes the native type=email check (which would block submit), fails zod.
  await page.getByLabel("Email").fill("user@localhost");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page.getByText("Name must be at least 2 characters")).toBeVisible();
  await expect(page.getByText("Invalid email address")).toBeVisible();
  await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
});

test("sign up through the UI lands on dashboard", async ({ page }, info) => {
  const email = `${unique(info, "signup")}@example.com`;
  await page.goto("/login");
  await page.getByLabel("Name").fill("New Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Welcome New Person")).toBeVisible();
});

test("sign in with existing account", async ({ page, request }, info) => {
  const email = `${unique(info, "signin")}@example.com`;
  await createUser(request, email, "Returning User");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Welcome Returning User")).toBeVisible();
});

test("wrong password shows an error", async ({ page, request }, info) => {
  const email = `${unique(info, "badpw")}@example.com`;
  await createUser(request, email);
  await signIn(page, email, "definitely-wrong");
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("sign out returns to anonymous state", async ({ page, request }, info) => {
  const email = `${unique(info, "signout")}@example.com`;
  await createUser(request, email, "Leaving User");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("button", { name: "Leaving User" }).click();
  await page.getByRole("menuitem", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});
