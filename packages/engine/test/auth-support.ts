import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth/password.ts";
import type { AppOptions } from "../src/auth/routes.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { insertAccount } from "../src/queries/insert-account.ts";

export const credentials = {
  username: "example-admin",
  password: "invented-password",
};
export const requestedWith = { "X-Requested-With": "XMLHttpRequest" };
export const dummyHash = await hashPassword("invented-dummy-password");
export function fixture(
  context: TestContext,
  overrides: Partial<AppOptions> = {},
) {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const database = connection.database;
  let now = new Date("2026-01-01T00:00:00.000Z");
  const clock = { now: () => now };
  const admin = insertAccount(database, {
    username: credentials.username,
    password_hash: "example-hash",
    timezone: "Asia/Kolkata",
    is_admin: 1,
    created_at: now.toISOString(),
  });
  assert.ok(admin);
  const calls: string[] = [];
  const app = createApp({
    database,
    clock,
    config: loadConfig({ DATABASE_URL: ":memory:" }),
    dummyHash,
    verifyPassword: async (password, stored) => {
      calls.push(stored);
      return password === credentials.password && stored === "example-hash";
    },
    ...overrides,
  });
  const signIn = (
    body: unknown = credentials,
    headers: Record<string, string> = requestedWith,
  ) =>
    app.request("/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const rows = () =>
    database.prepare("SELECT * FROM sessions ORDER BY token_hash").all();
  const userCount = () =>
    database.prepare("SELECT count(*) AS count FROM users").get();
  return {
    app,
    database,
    admin,
    calls,
    signIn,
    rows,
    userCount,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}
export function cookie(response: Response): string {
  const value = response.headers.get("Set-Cookie");
  assert.ok(value);
  return value.split(";", 1)[0] as string;
}
export async function rejection(
  response: Response,
  status: number,
  code: string,
  noStore = true,
) {
  assert.equal(response.status, status);
  assert.match(
    response.headers.get("Content-Type") ?? "",
    /^application\/json/,
  );
  if (noStore) assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.deepEqual(await response.json(), { error: { code } });
}
export async function publicUser(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const { user } = await response.json();
  assert.deepEqual(Object.keys(user).sort(), [
    "day_start_hour",
    "id",
    "is_admin",
    "timezone",
    "username",
  ]);
  assert.equal(typeof user.is_admin, "boolean");
  return user;
}
