import type { Session } from "@app/auth";
import type { Database } from "@app/db";

export type Context = {
  session: Session | null;
  db: Database;
};
