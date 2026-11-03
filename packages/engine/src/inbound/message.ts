import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";

const parserOptions = {
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipImageLinks: true,
  skipTextLinks: true,
  keepCidLinks: true,
  ignoreEmbedded: true,
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
