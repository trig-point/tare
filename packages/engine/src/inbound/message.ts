import { createHash } from "node:crypto";
import { dkimVerify } from "mailauth/lib/dkim/verify";
import { simpleParser } from "mailparser";
import { type Config, domainMatches } from "../config.ts";

const parserOptions = {
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipImageLinks: true,
  skipTextLinks: true,
  keepCidLinks: true,
  ignoreEmbedded: true,
};
export type DkimResolver = NonNullable<
  Parameters<typeof dkimVerify>[1]
>["resolver"];
export type Mark = {
  mark: "verified" | "sender_matched" | "unverified";
  service: string | null;
};

export async function selectMessage(raw: Buffer) {
  const wrapper = await simpleParser(raw, parserOptions);
  const originals = wrapper.attachments.filter(
    (part) => part.contentType === "message/rfc822",
  );
  const bytes =
    originals.length === 1 && originals[0] ? originals[0].content : raw;
  const mail =
    originals.length === 1 ? await simpleParser(bytes, parserOptions) : wrapper;
  if (mail.headers.size === 0) throw new Error("Unreadable email");
  return {
    bytes,
    mail,
    attached: originals.length === 1 ? 1 : 0,
    dedupeKey: mail.messageId
      ? `mid:${mail.messageId}`
      : `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export async function markMessage(
  subject: Awaited<ReturnType<typeof selectMessage>>,
  services: Config["orderEmailServices"],
  resolver?: DkimResolver,
): Promise<Mark> {
  const verification = await dkimVerify(subject.bytes, { resolver });
  const fields = subject.mail.headerLines.map((line) => line.key);
  for (const result of verification.results) {
    // l= can leave appended body bytes unsigned, and a repeated field is signed bottom-up
    // while mailparser reads the top instance, so both must be fully covered.
    if (result.status.result !== "pass" || result.status.underSized) continue;
    const signed = (result.signingHeaders?.keys ?? "")
      .split(":")
      .map((key) => key.trim().toLowerCase());
    if (
      ["from", "subject"].some(
        (name) => countOf(fields, name) > countOf(signed, name),
      )
    )
      continue;
    const domain = result.signingDomain?.toLowerCase();
    for (const [service, settings] of Object.entries(services))
      if (
        domain &&
        settings.dkim_domains.some((accepted) =>
          domainMatches(domain, accepted),
        )
      )
        return { mark: "verified", service };
  }
  const senders = subject.mail.from?.value ?? [];
  if (senders.length === 1 && senders[0]?.address) {
    const address = senders[0].address.toLowerCase();
    for (const [service, settings] of Object.entries(services))
      if (settings.senders.includes(address))
        return { mark: "sender_matched", service };
  }
  return { mark: "unverified", service: null };
}

function countOf(names: string[], name: string) {
  return names.filter((candidate) => candidate === name).length;
}

export function errorClass(error: unknown): string {
  return error instanceof TypeError
    ? "TypeError"
    : error instanceof RangeError
      ? "RangeError"
      : "Error";
}
