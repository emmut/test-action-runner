import { test as setup } from "@playwright/test";
import { STORAGE_STATE, createUser } from "./helpers";

setup("create and authenticate shared user", async ({ request }) => {
  await createUser(request, `shared-${Date.now()}@example.com`, "Shared User");
  await request.storageState({ path: STORAGE_STATE });
});
