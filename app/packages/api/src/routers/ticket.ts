import { auditEvent, ticket, ticketNote } from "@app/db/schema/ticket";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import z from "zod";

import { protectedProcedure, router } from "../index";
import type { Context } from "../context";

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const STATUSES = ["open", "triaged", "in_progress", "resolved"] as const;
export const CATEGORIES = ["billing", "bug", "access", "feature", "other"] as const;

const priorityRank = sql`case ${ticket.priority} when 'low' then 0 when 'medium' then 1 when 'high' then 2 else 3 end`;
const sortColumns = {
  id: ticket.id,
  title: ticket.title,
  customer: ticket.customer,
  priority: priorityRank,
  status: ticket.status,
};

type Db = Context["db"];

async function load(db: Db, id: number) {
  const [row] = await db.select().from(ticket).where(eq(ticket.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Ticket ${id} not found` });
  return row;
}

async function audit(db: Db, ticketId: number, action: string, detail: string, actor: string) {
  await db.insert(auditEvent).values({ ticketId, action, detail, actor });
}

export const ticketRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        batch: z.string().optional(),
        q: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        sort: z.enum(["id", "title", "customer", "priority", "status"]).default("id"),
        dir: z.enum(["asc", "desc"]).default("asc"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input, ctx }) => {
      const filters: SQL[] = [];
      if (input.batch) filters.push(eq(ticket.batch, input.batch));
      if (input.status) filters.push(eq(ticket.status, input.status));
      if (input.priority) filters.push(eq(ticket.priority, input.priority));
      if (input.q) {
        const term = `%${input.q}%`;
        filters.push(or(ilike(ticket.title, term), ilike(ticket.customer, term))!);
      }
      const where = filters.length ? and(...filters) : undefined;
      const order = input.dir === "asc" ? asc : desc;
      const [rows, totals] = await Promise.all([
        ctx.db
          .select()
          .from(ticket)
          .where(where)
          .orderBy(order(sortColumns[input.sort]), asc(ticket.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.db.select({ total: count() }).from(ticket).where(where),
      ]);
      return { rows, total: totals[0]?.total ?? 0 };
    }),

  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
    const row = await load(ctx.db, input.id);
    const [notes, events] = await Promise.all([
      ctx.db.select().from(ticketNote).where(eq(ticketNote.ticketId, input.id)).orderBy(asc(ticketNote.id)),
      ctx.db.select().from(auditEvent).where(eq(auditEvent.ticketId, input.id)).orderBy(asc(auditEvent.id)),
    ]);
    return { ...row, notes, events };
  }),

  triage: protectedProcedure
    .input(z.object({ id: z.number(), category: z.enum(CATEGORIES), priority: z.enum(PRIORITIES) }))
    .mutation(async ({ input, ctx }) => {
      const row = await load(ctx.db, input.id);
      if (row.status !== "open") throw new TRPCError({ code: "BAD_REQUEST", message: "Only open tickets can be triaged" });
      await ctx.db
        .update(ticket)
        .set({ status: "triaged", category: input.category, priority: input.priority })
        .where(eq(ticket.id, input.id));
      await audit(ctx.db, input.id, "triaged", `${input.category} / ${input.priority}`, ctx.session.user.name);
    }),

  assign: protectedProcedure
    .input(z.object({ id: z.number(), assignee: z.string().trim().min(2, "Assignee must be at least 2 characters") }))
    .mutation(async ({ input, ctx }) => {
      const row = await load(ctx.db, input.id);
      if (row.status !== "triaged") throw new TRPCError({ code: "BAD_REQUEST", message: "Triage the ticket first" });
      await ctx.db.update(ticket).set({ status: "in_progress", assignee: input.assignee }).where(eq(ticket.id, input.id));
      await audit(ctx.db, input.id, "assigned", input.assignee, ctx.session.user.name);
    }),

  addNote: protectedProcedure
    .input(z.object({ id: z.number(), body: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      await load(ctx.db, input.id);
      await ctx.db.insert(ticketNote).values({ ticketId: input.id, body: input.body });
      await audit(ctx.db, input.id, "noted", input.body.slice(0, 40), ctx.session.user.name);
    }),

  resolve: protectedProcedure
    .input(z.object({ id: z.number(), resolution: z.string().trim().min(5, "Resolution must be at least 5 characters") }))
    .mutation(async ({ input, ctx }) => {
      const row = await load(ctx.db, input.id);
      if (row.status !== "in_progress") throw new TRPCError({ code: "BAD_REQUEST", message: "Assign the ticket first" });
      await ctx.db.update(ticket).set({ status: "resolved", resolution: input.resolution }).where(eq(ticket.id, input.id));
      await audit(ctx.db, input.id, "resolved", input.resolution.slice(0, 40), ctx.session.user.name);
    }),

  reopen: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const row = await load(ctx.db, input.id);
    if (row.status !== "resolved") throw new TRPCError({ code: "BAD_REQUEST", message: "Only resolved tickets can be reopened" });
    await ctx.db.update(ticket).set({ status: "in_progress", resolution: null }).where(eq(ticket.id, input.id));
    await audit(ctx.db, input.id, "reopened", "", ctx.session.user.name);
  }),

  audit: protectedProcedure
    .input(
      z.object({
        batch: z.string().optional(),
        action: z.string().optional(),
        page: z.number().int().min(1).default(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const filters: SQL[] = [];
      if (input.batch) filters.push(eq(ticket.batch, input.batch));
      if (input.action) filters.push(eq(auditEvent.action, input.action));
      const where = filters.length ? and(...filters) : undefined;
      const pageSize = 20;
      const [rows, totals] = await Promise.all([
        ctx.db
          .select({
            id: auditEvent.id,
            action: auditEvent.action,
            detail: auditEvent.detail,
            actor: auditEvent.actor,
            ticketId: ticket.id,
            title: ticket.title,
          })
          .from(auditEvent)
          .innerJoin(ticket, eq(auditEvent.ticketId, ticket.id))
          .where(where)
          .orderBy(desc(auditEvent.id))
          .limit(pageSize)
          .offset((input.page - 1) * pageSize),
        ctx.db
          .select({ total: count() })
          .from(auditEvent)
          .innerJoin(ticket, eq(auditEvent.ticketId, ticket.id))
          .where(where),
      ]);
      return { rows, total: totals[0]?.total ?? 0, pageSize };
    }),
});
