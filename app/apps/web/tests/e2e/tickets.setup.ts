import { test as setup } from "@playwright/test";
import { AUDIT_BATCH, TABLE_BATCH, TABLE_SIZE, deleteBatches, seedHistory, seedTickets } from "./seed";

setup("seed ticket table and audit history", async () => {
  await deleteBatches("e2e-");
  await seedTickets(TABLE_BATCH, TABLE_SIZE, true);
  await seedHistory(AUDIT_BATCH, 30, 5);
});
