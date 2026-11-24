"use client";
import { Button } from "@app/ui/components/button";
import { Input } from "@app/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

import { useTRPC } from "@/utils/trpc";

const SORTABLE = [
  ["id", "#"],
  ["title", "Title"],
  ["customer", "Customer"],
  ["priority", "Priority"],
  ["status", "Status"],
] as const;
type SortKey = (typeof SORTABLE)[number][0];
const PAGE_SIZE = 25;

export function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    router.replace(`${pathname}?${next}` as Route);
  };
  return { params, set };
}

export const selectClass = "h-8 border border-input bg-transparent px-2 text-xs";

export default function TicketTable() {
  const trpc = useTRPC();
  const { params, set } = useUrlState();
  const sort = (params.get("sort") ?? "id") as SortKey;
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  const page = Number(params.get("page") ?? 1);
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const priority = params.get("priority") ?? "";

  const tickets = useQuery(
    trpc.ticket.list.queryOptions({
      batch: params.get("batch") ?? undefined,
      q: q || undefined,
      status: (status || undefined) as never,
      priority: (priority || undefined) as never,
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const total = tickets.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    set({ q: String(new FormData(e.currentTarget).get("q") ?? "") || undefined, page: undefined });
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Tickets</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="flex gap-2" key={q}>
          <Input name="q" defaultValue={q} placeholder="Search title or customer" aria-label="Search" />
          <Button type="submit">Search</Button>
        </form>
        <select
          aria-label="Status filter"
          className={selectClass}
          value={status}
          onChange={(e) => set({ status: e.target.value || undefined, page: undefined })}
        >
          <option value="">All statuses</option>
          <option value="open">open</option>
          <option value="triaged">triaged</option>
          <option value="in_progress">in_progress</option>
          <option value="resolved">resolved</option>
        </select>
        <select
          aria-label="Priority filter"
          className={selectClass}
          value={priority}
          onChange={(e) => set({ priority: e.target.value || undefined, page: undefined })}
        >
          <option value="">All priorities</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
      </div>

      {tickets.isLoading ? (
        <p role="status">Loading tickets…</p>
      ) : tickets.error ? (
        <p role="alert">{tickets.error.message}</p>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {SORTABLE.map(([key, label]) => (
                  <th
                    key={key}
                    className="border-b p-2 text-left"
                    aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        set({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc", page: undefined })
                      }
                    >
                      {label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.data?.rows.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="p-2">{t.id}</td>
                  <td className="p-2">
                    <Link href={`/tickets/${t.id}`} className="underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="p-2">{t.customer}</td>
                  <td className="p-2">{t.priority}</td>
                  <td className="p-2">{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-center gap-4">
            <span>{total} tickets</span>
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
