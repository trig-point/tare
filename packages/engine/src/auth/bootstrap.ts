import type { Database } from "better-sqlite3";
import type { Config } from "../config.ts";
import { countSignInCapableUsers } from "../queries/count-sign-in-capable-users.ts";
import { countUsers } from "../queries/count-users.ts";
import { insertAccount } from "../queries/insert-account.ts";
import { normalizeAccessEmail } from "./access.ts";
import { isValidPassword, normalizeUsername } from "./password.ts";

export function ensureSignInCapableUsers(
  database: Database,
  identity: Config["identity"],
): void {
  const counts = countSignInCapableUsers(database);
  if (!counts) throw new Error("Could not count sign-in-capable users");
  if (
    identity.mode === "access"
      ? counts.access_count === 0
      : counts.password_count === 0
  )
    throw new Error(
      `This install was set up in ${identity.mode === "access" ? "fallback" : "access"} mode; switching modes is not supported`,
    );
}

export async function ensureFirstUser(
  database: Database,
  firstUser: Config["firstUser"],
  timezone: string,
  clock: { now(): Date },
  hashPassword: (password: string) => Promise<string>,
  identity: Config["identity"] = { mode: "fallback" },
): Promise<void> {
  const hasUsers = () => {
    const result = countUsers(database);
    if (!result) throw new Error("Could not count users");
    return result.count > 0;
  };
  if (database.transaction(hasUsers).immediate()) return;
  const missing = [];
  if (firstUser.username === undefined || firstUser.username.trim() === "")
    missing.push("TARE_ADMIN_USERNAME");
  const accessEmail = normalizeAccessEmail(firstUser.accessEmail ?? "");
  if (identity.mode === "access" && accessEmail === null)
    missing.push("TARE_ADMIN_ACCESS_EMAIL");
  if (
    identity.mode === "fallback" &&
    (firstUser.password === undefined || firstUser.password === "")
  )
    missing.push("TARE_ADMIN_PASSWORD");
  if (missing.length > 0) {
    throw new Error(
      `No users exist. Set ${missing.join(" and ")} to create the first administrator.`,
    );
  }
  const username = normalizeUsername(firstUser.username);
  if (username === null)
    throw new Error("TARE_ADMIN_USERNAME must have 1 to 64 characters");
  if (identity.mode === "fallback" && !isValidPassword(firstUser.password))
    throw new Error("TARE_ADMIN_PASSWORD must have 1 to 1024 characters");
  const passwordHash =
    identity.mode === "fallback" && isValidPassword(firstUser.password)
      ? await hashPassword(firstUser.password)
      : null;
  database
    .transaction(() => {
      if (hasUsers()) return;
      const account = insertAccount(database, {
        username,
        password_hash: passwordHash,
        access_email: identity.mode === "access" ? accessEmail : null,
        timezone,
        is_admin: 1,
        created_at: clock.now().toISOString(),
      });
      if (!account) throw new Error("Could not create the first administrator");
    })
    .immediate();
}
