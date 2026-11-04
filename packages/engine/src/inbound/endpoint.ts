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
import {
  type DkimResolver,
  errorClass,
  type Mark,
  markMessage,
  selectMessage,
} from "./message.ts";
import { heldEmailKind } from "./questions.ts";

export interface InboundOptions {
  dkimResolver?: DkimResolver;
  markEmail?: typeof markMessage;
  onEmailQueued?: () => unknown;
}

// Subject and From are sender-controlled, and ";" separates the prompt's fields.
// Keeping only visible characters and plain spaces drops controls, bidi and line separators.
function promptField(text: string, limit: number) {
  const visible = text
    .replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu, "")
    .replaceAll(";", ",");
  return Array.from(visible).slice(0, limit).join("");
}

export function mountInboundEmail(
  app: Hono<AuthEnv>,
  options: AppOptions &
    InboundOptions & { questionKinds: ReadonlyMap<string, QuestionKind> },
) {
  const inbound = new Hono<{ Variables: { ownerId: number } }>();
  let kickFailures = 0;
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
      let mark: Mark;
      let reasonClass: string | null = null;
      try {
        mark = await (options.markEmail ?? markMessage)(
          subject,
          options.config.orderEmailServices,
          options.dkimResolver,
        );
      } catch (error) {
        mark = { mark: "unverified", service: null };
        reasonClass = errorClass(error);
      }
      const now = options.clock.now();
      const result = writeTransaction(options.database, () => {
        const inserted = insertInboundEmail(options.database, {
          ...key,
          ...mark,
          raw,
          subject_attached: subject.attached,
          parse_state: mark.mark === "unverified" ? "held" : "queued",
          reason_class: reasonClass,
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
      if (result.mark !== "unverified" && options.onEmailQueued)
        void Promise.resolve()
          .then(options.onEmailQueued)
          .catch(() =>
            console.error("inbound_parse_kick_failed", ++kickFailures),
          );
      return context.json(result, 202);
    },
  );
  app.route("/", inbound);
}
