"use client";
import { Button } from "@app/ui/components/button";
import { Input } from "@app/ui/components/input";
import { Label } from "@app/ui/components/label";
import { Textarea } from "@app/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "@/utils/trpc";

import { selectClass } from "../ticket-table";

export default function TicketPage() {
  const id = Number(useParams<{ id: string }>().id);
  const trpc = useTRPC();
  const ticket = useQuery(trpc.ticket.get.queryOptions({ id }));
  const refetch = { onSuccess: () => ticket.refetch() };
  const triage = useMutation(trpc.ticket.triage.mutationOptions(refetch));
  const assign = useMutation(trpc.ticket.assign.mutationOptions(refetch));
  const addNote = useMutation(trpc.ticket.addNote.mutationOptions(refetch));
  const resolve = useMutation(trpc.ticket.resolve.mutationOptions(refetch));
  const reopen = useMutation(trpc.ticket.reopen.mutationOptions(refetch));

  const [category, setCategory] = useState("bug");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  if (ticket.isLoading) return <p role="status">Loading ticket…</p>;
  if (ticket.error || !ticket.data) return <p role="alert">{ticket.error?.message}</p>;
  const t = ticket.data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4">
      <Link href="/tickets" className="underline">
        Back to tickets
      </Link>
      <h1 className="text-2xl font-bold">
        Ticket #{t.id}: {t.title}
      </h1>
      <dl className="grid grid-cols-2 gap-2 text-sm" aria-label="Ticket details">
        {(
          [
            ["Status", t.status],
            ["Customer", t.customer],
            ["Priority", t.priority],
            ["Category", t.category ?? "—"],
            ["Assignee", t.assignee ?? "—"],
            ["Resolution", t.resolution ?? "—"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium">{k}</dt>
            <dd data-field={k}>{v}</dd>
          </div>
        ))}
      </dl>

      {error && <p role="alert" className="text-red-500">{error}</p>}

      {t.status === "open" && (
        <section aria-label="Triage" className="space-y-2 border p-4">
          <h2 className="font-medium">Triage</h2>
          <select aria-label="Category" className={selectClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {["billing", "bug", "access", "feature", "other"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Set priority"
            className={selectClass}
            value={priority || t.priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {["low", "medium", "high", "urgent"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <Button
            disabled={triage.isPending}
            onClick={() => triage.mutate({ id, category: category as never, priority: (priority || t.priority) as never })}
          >
            Save triage
          </Button>
        </section>
      )}

      {t.status === "triaged" && (
        <section aria-label="Assign" className="space-y-2 border p-4">
          <Label htmlFor="assignee">Assignee</Label>
          <Input id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          <Button
            disabled={assign.isPending}
            onClick={() => {
              if (assignee.trim().length < 2) return setError("Assignee must be at least 2 characters");
              setError("");
              assign.mutate({ id, assignee });
            }}
          >
            Assign
          </Button>
        </section>
      )}

      {t.status === "in_progress" && !resolving && <Button onClick={() => setResolving(true)}>Resolve</Button>}
      {t.status === "resolved" && (
        <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate({ id })}>
          Reopen
        </Button>
      )}

      {resolving && (
        <div role="dialog" aria-label="Resolve ticket" className="space-y-2 border p-4">
          <Label htmlFor="resolution">Resolution</Label>
          <Textarea id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <div className="flex gap-2">
            <Button
              disabled={resolve.isPending}
              onClick={() => {
                if (resolution.trim().length < 5) return setError("Resolution must be at least 5 characters");
                setError("");
                resolve.mutate({ id, resolution }, { onSuccess: () => setResolving(false) });
              }}
            >
              Confirm resolve
            </Button>
            <Button variant="outline" onClick={() => setResolving(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <section aria-label="Notes" className="space-y-2">
        <h2 className="font-medium">Notes</h2>
        <ol className="list-decimal pl-6">
          {t.notes.map((n) => (
            <li key={n.id}>{n.body}</li>
          ))}
        </ol>
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          disabled={addNote.isPending || !note.trim()}
          onClick={() => addNote.mutate({ id, body: note }, { onSuccess: () => setNote("") })}
        >
          Add note
        </Button>
      </section>

      <section aria-label="History">
        <h2 className="font-medium">History</h2>
        <ol className="pl-6 text-sm">
          {t.events.map((e) => (
            <li key={e.id}>
              {e.action}: {e.detail}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
