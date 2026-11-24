import { createAuth } from "@app/auth";
import { createDb } from "@app/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
