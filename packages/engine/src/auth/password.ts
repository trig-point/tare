import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const PASSWORD_MAX_LENGTH = 1024;
export const USERNAME_MAX_LENGTH = 64;

export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length >= 1 &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

export function normalizeUsername(username: unknown): string | null {
  if (typeof username !== "string") return null;
  const trimmed = username.trim();
  return trimmed.length >= 1 && trimmed.length <= USERNAME_MAX_LENGTH
    ? trimmed
    : null;
}

const parameters = "N=32768,r=8,p=3";
const allowedParameters = new Set([parameters]);

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      Buffer.from(password, "utf8"),
      salt,
      32,
      {
        N: 32768,
        r: 8,
        p: 3,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!isValidPassword(password)) throw new Error("Invalid password length");
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${parameters}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    if (!isValidPassword(password) || typeof stored !== "string") return false;
    const fields = stored.split("$");
    const [algorithm, tuple, saltText, keyText] = fields;
    if (
      fields.length !== 4 ||
      algorithm !== "scrypt" ||
      tuple === undefined ||
      !allowedParameters.has(tuple) ||
      saltText === undefined ||
      keyText === undefined
    )
      return false;
    const salt = Buffer.from(saltText, "base64url");
    const key = Buffer.from(keyText, "base64url");
    if (
      salt.length !== 16 ||
      key.length !== 32 ||
      salt.toString("base64url") !== saltText ||
      key.toString("base64url") !== keyText
    )
      return false;
    return timingSafeEqual(await deriveKey(password, salt), key);
  } catch {
    return false;
  }
}
