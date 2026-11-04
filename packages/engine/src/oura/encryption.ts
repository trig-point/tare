import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z as zod } from "zod";

const pairSchema = zod.strictObject({
  access_token: zod.string().min(1),
  refresh_token: zod.string().min(1),
});
export type TokenPair = zod.infer<typeof pairSchema>;
export interface Envelope {
  version: number;
  ciphertext: string;
  iv: string;
  tag: string;
}
const aad = (owner: number, version: number) =>
  Buffer.from(`oura:${owner}:${version}`);

export function encryptPair(
  pair: TokenPair,
  owner: number,
  key: Buffer,
): Envelope {
  const version = 1;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(aad(owner, version));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(pairSchema.parse(pair)), "utf8"),
    cipher.final(),
  ]);
  return {
    version,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptPair(
  envelope: Envelope,
  owner: number,
  key: Buffer | undefined,
): TokenPair | null {
  if (!key) return null;
  try {
    if (envelope.version !== 1) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
      { authTagLength: 16 },
    );
    decipher.setAAD(aad(owner, envelope.version));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return pairSchema.parse(JSON.parse(text.toString("utf8")));
  } catch {
    return null;
  }
}
