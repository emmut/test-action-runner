import pg from "pg";

// One small pool per Playwright worker; allowExitOnIdle lets the worker exit cleanly.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true });

export const TABLE_BATCH = "e2e-table";
export const TABLE_SIZE = 3000;
export const AUDIT_BATCH = "e2e-audit";

/** Insert n tickets. mixed=true spreads statuses evenly (for read-only table specs). */
export async function seedTickets(batch: string, n: number, mixed = false) {
  const { rows } = await pool.query<{ id: number; title: string }>(
    `insert into ticket (batch, title, customer, priority, status, created_at)
     select $1,
       'Ticket ' || lpad(g::text, 5, '0') || ' ' || (array['printer','login','invoice','export','sync','upload'])[1 + g % 6],
       (array['Acme','Globex','Initech','Umbrella','Hooli','Stark','Wayne','Wonka'])[1 + g % 8] || ' ' || (g % 50),
       (array['low','medium','high','urgent'])[1 + (g * 7) % 4],
       case when $3 then (array['open','triaged','in_progress','resolved'])[1 + g % 4] else 'open' end,
       now() - (g || ' minutes')::interval
     from generate_series(1, $2) g
     returning id, title`,
    [batch, n, mixed],
  );
  return rows;
}

/** Tickets with a pre-built history, for audit-log specs. */
export async function seedHistory(batch: string, tickets: number, eventsPerTicket: number) {
  const created = await seedTickets(batch, tickets);
  await pool.query(
    `insert into audit_event (ticket_id, action, detail, actor)
     select tid, (array['triaged','assigned','noted','resolved','reopened'])[1 + e % 5], 'seeded event ' || e, 'Seeder'
     from unnest($1::int[]) as u(tid), generate_series(1, $2) e`,
    [created.map((r) => r.id), eventsPerTicket],
  );
  return created;
}

export async function deleteBatches(prefix: string) {
  await pool.query("delete from ticket where batch like $1", [`${prefix}%`]);
}
