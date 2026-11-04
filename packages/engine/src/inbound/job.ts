import { parseOrderEmail } from "@tare/order-parser";
import type { Database } from "better-sqlite3";
import type { Config } from "../config.ts";
import { writeTransaction } from "../db.ts";
import { localDay } from "../logging/day.ts";
import { selectPerson } from "../queries/select-person.ts";
import { selectQueuedInboundEmail } from "../queries/select-queued-inbound-email.ts";
import { selectUnreconciledEmail } from "../queries/select-unreconciled-email.ts";
import { updateInboundParse } from "../queries/update-inbound-parse.ts";
import type { QuestionKind } from "../questions/kinds.ts";
import { errorClass, selectMessage } from "./message.ts";
import { createOrderQuestionKinds } from "./questions.ts";
import { reconcileEmail } from "./reconcile.ts";

export function createOrderEmailParseJob({
  database,
  clock,
  model,
  questionKinds,
  services = {},
}: {
  database: Database;
  clock: { now(): Date };
  model: Parameters<typeof parseOrderEmail>[1];
  questionKinds?: ReadonlyMap<string, QuestionKind>;
  services?: Config["orderEmailServices"];
}) {
  const registry =
    questionKinds ?? createOrderQuestionKinds({ clock, services });
  const reconcile = (email: { id: number; user_id: number }) =>
    writeTransaction(database, (scope) => {
      const person = selectPerson(database, { id: email.user_id });
      if (!person) throw new Error("Email owner is missing");
      reconcileEmail(
        scope,
        email,
        person,
        clock.now().toISOString(),
        { questionKinds: registry, services },
        "job",
      );
    });
  return {
    name: "order-email-parse",
    schedule: "*/5 * * * *",
    async run({ signal }: { signal: AbortSignal }) {
      let afterId = 0;
      let parsed = 0;
      let failed = 0;
      const reconcileRow = (email: { id: number; user_id: number }) => {
        try {
          reconcile(email);
        } catch (error) {
          failed++;
          console.error(
            "inbound_email_reconcile_failed",
            email.id,
            errorClass(error),
          );
        }
      };
      for (;;) {
        signal.throwIfAborted();
        const row = selectQueuedInboundEmail(database, { after_id: afterId });
        if (!row) break;
        afterId = row.id;
        let result: Awaited<ReturnType<typeof parseOrderEmail>>;
        let reasonClass: string | null = null;
        try {
          const { mail } = await selectMessage(Buffer.from(row.raw));
          result = await parseOrderEmail(
            {
              subject: mail.subject ?? "",
              text: mail.text,
              html: mail.html || undefined,
            },
            model,
            {
              received_on: localDay(
                row.created_at,
                row.timezone,
                row.day_start_hour,
              ),
            },
          );
        } catch (error) {
          reasonClass = errorClass(error);
          result = { status: "failed", reason: "invalid_reply" };
        }
        writeTransaction(database, () =>
          updateInboundParse(
            database,
            {
              parse_state: result.status,
              parse_result: JSON.stringify(result),
              reason_class: reasonClass,
              now: clock.now().toISOString(),
            },
            { id: row.id, user_id: row.user_id },
          ),
        );
        if (result.status === "failed") {
          failed++;
          console.error(
            "inbound_email_parse_failed",
            row.id,
            reasonClass ?? result.reason,
          );
        } else parsed++;
      }
      afterId = 0;
      for (;;) {
        signal.throwIfAborted();
        const email = selectUnreconciledEmail(database, { after_id: afterId });
        if (!email) break;
        afterId = email.id;
        reconcileRow(email);
      }
      const code = `emails_parsed:${parsed}`;
      if (failed) {
        console.error(`${code} failed:${failed}`);
        throw new Error("Order email parse failed");
      }
      return code;
    },
  };
}
