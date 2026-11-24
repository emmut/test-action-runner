import { test as teardown } from "@playwright/test";
import { deleteBatches } from "./seed";

teardown("delete e2e ticket data", async () => {
  await deleteBatches("e2e-");
});
