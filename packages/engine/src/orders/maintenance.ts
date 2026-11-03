import { setImmediate } from "node:timers/promises";
import type { Database } from "better-sqlite3";
import { writeTransaction } from "../db.ts";
import { listUndeliveredOrders } from "../queries/orders/list-undelivered-orders.ts";
import { selectPerson } from "../queries/select-person.ts";
import { isDue, recordDelivery } from "./index.ts";

export function createOrderMaintenanceJob({
  database,
  clock,
}: {
  database: Database;
  clock: { now(): Date };
}) {
  return {
    name: "order-maintenance",
    schedule: "0 4 * * *",
    async run({ signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      let recorded = 0;
      for (const order of listUndeliveredOrders(database)) {
        await setImmediate(undefined, { signal });
        writeTransaction(database, (scope) => {
          const person = selectPerson(database, { id: order.user_id });
          if (!person) throw new Error("Order owner missing");
          const now = clock.now().toISOString();
          if (isDue(order, person, now)) {
            if (recordDelivery(scope, person.id, order.id, now)) recorded++;
          }
        });
      }
      return `deliveries_recorded:${recorded}`;
    },
  };
}
