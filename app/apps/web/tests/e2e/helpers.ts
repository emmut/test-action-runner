import type { APIRequestContext, TestInfo } from "@playwright/test";

export const API_URL = `http://localhost:${process.env.API_PORT ?? "3000"}`;
// API calls from Node have no browser Origin; send the web app's so the auth server accepts them.
export const ORIGIN = `http://localhost:${process.env.WEB_PORT ?? "3001"}`;
export const STORAGE_STATE = "playwright/.auth/user.json";
export const PASSWORD = "e2e-password-123";

/** Unique per test, project and retry so parallel workers never collide. */
export function unique(info: TestInfo, prefix: string) {
  return `${prefix}-${info.project.name}-${info.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createUser(request: APIRequestContext, email: string, name = "E2E User") {
  const res = await request.post(`${API_URL}/api/auth/sign-up/email`, {
    headers: { Origin: ORIGIN },
    data: { email, name, password: PASSWORD },
  });
  if (!res.ok()) throw new Error(`sign-up failed: ${res.status()} ${await res.text()}`);
}
