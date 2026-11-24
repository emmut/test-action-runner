"use client";
import { Button } from "@app/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense } from "react";

import { useTRPC } from "@/utils/trpc";

import { selectClass, useUrlState } from "../tickets/ticket-table";

function AuditLog() {
  const trpc = useTRPC();
  const { params, set } = useUrlState();
  const page = Number(params.get("page") ?? 1);
  const action = params.get("action") ?? "";
  const audit = useQuery(
    trpc.ticket.audit.queryOptions({ batch: params.get("batch") ?? undefined, action: action || undefined, page }),
  );
  const total = audit.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (audit.data?.pageSize ?? 20)));

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Audit log</h1>
      <select
        aria-label="Action filter"
        className={`${selectClass} mb-4`}
        value={action}
        onChange={(e) => set({ action: e.target.value || undefined, page: undefined })}
      >
        <option value="">All actions</option>
        {["triaged", "assigned", "noted", "resolved", "reopened"].map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      {audit.isLoading ? (
        <p role="status">Loading audit log…</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left">Action</th>
                <th className="p-2 text-left">Ticket</th>
                <th className="p-2 text-left">Detail</th>
                <th className="p-2 text-left">By</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.rows.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2">{r.action}</td>
                  <td className="p-2">
                    <Link href={`/tickets/${r.ticketId}`} className="underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="p-2">{r.detail}</td>
                  <td className="p-2">{r.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-center gap-4">
            <span>{total} events</span>
            <Button variant="outline" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
              Previous
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button variant="outline" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
