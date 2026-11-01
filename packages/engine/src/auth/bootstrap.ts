import type { Database } from "better-sqlite3";
import type { Config } from "../config.ts";
import { countUsers } from "../queries/count-users.ts";
import { insertAccount } from "../queries/insert-account.ts";
import { isValidPassword, normalizeUsername } from "./password.ts";

export async function ensureFirstUser(
  database: Database,
  firstUser: Config["firstUser"],
  timezone: string,
  clock: { now(): Date },
  hashPassword: (password: string) => Promise<string>,
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
  if (firstUser.password === undefined || firstUser.password === "")
    missing.push("TARE_ADMIN_PASSWORD");
  if (missing.length > 0) {
    throw new Error(
      `No users exist. Set ${missing.join(" and ")} to create the first administrator.`,
    );
  }
  const username = normalizeUsername(firstUser.username);
  if (username === null)
    throw new Error("TARE_ADMIN_USERNAME must have 1 to 64 characters");
  if (!isValidPassword(firstUser.password))
    throw new Error("TARE_ADMIN_PASSWORD must have 1 to 1024 characters");
  const passwordHash = await hashPassword(firstUser.password);
  database
    .transaction(() => {
      if (hasUsers()) return;
      const account = insertAccount(database, {
        username,
        password_hash: passwordHash,
        timezone,
        is_admin: 1,
        created_at: clock.now().toISOString(),
      });
      if (!account) throw new Error("Could not create the first administrator");
    })
    .immediate();
}
