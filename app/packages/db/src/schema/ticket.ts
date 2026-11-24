import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ticket = pgTable(
  "ticket",
  {
    id: serial("id").primaryKey(),
    // Seed tag: e2e specs scope their data to a batch so parallel runs never collide.
    batch: text("batch").notNull().default("default"),
    title: text("title").notNull(),
    customer: text("customer").notNull(),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    category: text("category"),
    assignee: text("assignee"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ticket_batch_idx").on(t.batch), index("ticket_status_idx").on(t.status)],
);

export const ticketNote = pgTable("ticket_note", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => ticket.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditEvent = pgTable(
  "audit_event",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("audit_ticket_idx").on(t.ticketId)],
);
