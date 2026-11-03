import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AuthEnv } from "../auth/middleware.ts";
import type { AppOptions } from "../auth/routes.ts";
import { hashToken } from "../auth/sessions.ts";
import { writeTransaction } from "../db.ts";
import { insertInboundEmail } from "../queries/insert-inbound-email.ts";
import { selectInboundEmail } from "../queries/select-inbound-email.ts";
import { selectInboundOwner } from "../queries/select-inbound-owner.ts";
import { selectPerson } from "../queries/select-person.ts";
import { createQuestion, type QuestionKind } from "../questions/kinds.ts";
import { selectMessage } from "./message.ts";
import { heldEmailKind } from "./questions.ts";

// Subject and From are sender-controlled, and ";" separates the prompt's fields.
function promptField(text: string, limit: number) {
  return text
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replaceAll(";", ",")
    .slice(0, limit);
}

export function mountInboundEmail(
  app: Hono<AuthEnv>,
  options: AppOptions & { questionKinds: ReadonlyMap<string, QuestionKind> },
) {
  const inbound = new Hono<{ Variables: { ownerId: number } }>();
  inbound.post(
    "/api/inbound/email",
    async (context, next) => {
      context.header("Cache-Control", "no-store");
      const token = /^Bearer ([^\s]+)$/i.exec(
        context.req.header("Authorization") ?? "",
      )?.[1];
      const owner = token
        ? selectInboundOwner(options.database, { token_hash: hashToken(token) })
        : null;
      if (!owner)
        return context.json({ error: { code: "inbound_token_invalid" } }, 401);
      context.set("ownerId", owner.user_id);
      await next();
    },
    bodyLimit({
      maxSize: 5 * 1024 * 1024,
      onError: (context) =>
        context.json({ error: { code: "body_too_large" } }, 413),
    }),
    async (context) => {
      const raw = Buffer.from(await context.req.arrayBuffer());
      let subject: Awaited<ReturnType<typeof selectMessage>>;
      try {
        subject = await selectMessage(raw);
      } catch {
        return context.json({ error: { code: "unreadable_email" } }, 422);
      }
      const key = {
        user_id: context.get("ownerId"),
        dedupe_key: subject.dedupeKey,
      };
      const existing = selectInboundEmail(options.database, key);
      if (existing)
        return context.json({ email_id: existing.id, duplicate: true }, 200);
      const mark = { mark: "unverified" as const, service: null };
      const now = options.clock.now();
      const result = writeTransaction(options.database, () => {
        const inserted = insertInboundEmail(options.database, {
          ...key,
          ...mark,
          raw,
          subject_attached: subject.attached,
          parse_state: "held",
          reason_class: null,
          now: now.toISOString(),
        });
        if (!inserted) {
          const winner = selectInboundEmail(options.database, key);
          if (!winner) throw new Error("Duplicate email missing");
          return { email_id: winner.id, duplicate: true as const };
        }
        if (mark.mark === "unverified") {
          const person = selectPerson(options.database, { id: key.user_id });
          if (!person) throw new Error("Email owner missing");
          const from = subject.mail.from?.value;
          const title = promptField(subject.mail.subject ?? "", 120);
          const sender = promptField(
            from?.length === 1 ? (from[0]?.address ?? "") : "",
            254,
          );
          const received = now.toLocaleString("en-US", {
            timeZone: person.timezone,
            timeZoneName: "short",
          });
          createQuestion(
            options.database,
            {
              userId: key.user_id,
              kind: heldEmailKind.name,
              subjectRef: String(inserted.id),
              prompt: `${mark.mark}: ${title}; ${sender}; ${received}`,
            },
            options.clock,
            options.questionKinds,
          );
        }
        return {
          email_id: inserted.id,
          mark: mark.mark,
          duplicate: false as const,
        };
      });
      if (result.duplicate) return context.json(result, 200);
      console.info("inbound_email_marked", result.email_id, result.mark);
      return context.json(result, 202);
    },
  );
  app.route("/", inbound);
}
