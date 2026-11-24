import { Suspense } from "react";

import TicketTable from "./ticket-table";

export default function TicketsPage() {
  return (
    <Suspense>
      <TicketTable />
    </Suspense>
  );
}
