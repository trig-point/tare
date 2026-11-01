import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as runTest, type TestContext } from "node:test";
import { ensureFirstUser } from "../src/auth/bootstrap.ts";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { countUsers } from "../src/queries/count-users.ts";
import { insertAccount } from "../src/queries/insert-account.ts";
import { selectUser } from "../src/queries/select-user.ts";

const clock = { now: () => new Date("2024-02-29T12:00:00.000Z") };
const firstUser = {
  username: "  Example-Admin  ",
  password: "  invented-password  ",
};

const HANG_CEILING_MS = 60_000;

function test(
  name: string,
  run: (context: TestContext) => void | Promise<void>,
) {
  return runTest(name, { timeout: HANG_CEILING_MS }, run);
}

test("an empty database creates one administrator with the exact password and install timezone", async (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  await ensureFirstUser(
    connection.database,
    firstUser,
    "Asia/Kolkata",
    clock,
    async (password) => {
      assert.equal(connection.database.inTransaction, false);
      return hashPassword(password);
    },
  );
  assert.deepEqual(countUsers(connection.database), { count: 1 });
  const account = selectUser(connection.database, { id: 1 });
  assert.ok(account);
  assert.deepEqual(
    { ...account, password_hash: undefined },
    {
      id: 1,
      username: "Example-Admin",
      password_hash: undefined,
      timezone: "Asia/Kolkata",
      day_start_hour: 4,
      is_admin: 1,
      created_at: clock.now().toISOString(),
    },
  );
  assert.equal(
    await verifyPassword(firstUser.password, account.password_hash),
    true,
  );
  assert.equal(
    await verifyPassword(firstUser.password.trim(), account.password_hash),
    false,
  );
});

test("existing users bypass absent, half-set and invalid settings without hashing or changes", async (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  const account = insertAccount(connection.database, {
    username: "existing-example",
    password_hash: "invented-test-hash",
    timezone: "UTC",
    is_admin: 0,
    created_at: clock.now().toISOString(),
  });
  assert.ok(account);
  assert.equal(Object.hasOwn(account, "password_hash"), false);
  const original = selectUser(connection.database, { id: account.id });
  let hashes = 0;
  for (const settings of [
    { username: undefined, password: undefined },
    { username: "unused-example", password: undefined },
    { username: undefined, password: "unused-password" },
    { username: "x".repeat(65), password: "x".repeat(1025) },
    { username: "", password: "" },
  ]) {
    await ensureFirstUser(
      connection.database,
      settings,
      "Asia/Kolkata",
      clock,
      async () => {
        hashes++;
        return "unexpected-hash";
      },
    );
    assert.deepEqual(countUsers(connection.database), { count: 1 });
    assert.deepEqual(
      selectUser(connection.database, { id: account.id }),
      original,
    );
  }
  assert.equal(hashes, 0);
});

test("empty databases name only missing admin settings, including empty values", async (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  let hashes = 0;
  for (const [settings, missing] of [
    [{}, "TARE_ADMIN_USERNAME and TARE_ADMIN_PASSWORD"],
    [{ TARE_ADMIN_USERNAME: "Example-Admin" }, "TARE_ADMIN_PASSWORD"],
    [{ TARE_ADMIN_PASSWORD: "invented-password" }, "TARE_ADMIN_USERNAME"],
    [
      { TARE_ADMIN_USERNAME: "", TARE_ADMIN_PASSWORD: "" },
      "TARE_ADMIN_USERNAME and TARE_ADMIN_PASSWORD",
    ],
    [
      { TARE_ADMIN_USERNAME: "   ", TARE_ADMIN_PASSWORD: "invented-password" },
      "TARE_ADMIN_USERNAME",
    ],
    [
      { TARE_ADMIN_USERNAME: "Example-Admin", TARE_ADMIN_PASSWORD: "" },
      "TARE_ADMIN_PASSWORD",
    ],
  ] as const) {
    const config = loadConfig({ DATABASE_URL: ":memory:", ...settings });
    await assert.rejects(
      ensureFirstUser(
        connection.database,
        config.firstUser,
        config.timezone,
        clock,
        async () => {
          hashes++;
          return "unexpected-hash";
        },
      ),
      {
        message: `No users exist. Set ${missing} to create the first administrator.`,
      },
    );
  }
  assert.equal(hashes, 0);
  assert.deepEqual(countUsers(connection.database), { count: 0 });
});

test("overlong admin settings fail by setting name before hashing", async (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  let hashes = 0;
  for (const [settings, message] of [
    [
      { ...firstUser, username: "x".repeat(65) },
      "TARE_ADMIN_USERNAME must have 1 to 64 characters",
    ],
    [
      { ...firstUser, password: "x".repeat(1025) },
      "TARE_ADMIN_PASSWORD must have 1 to 1024 characters",
    ],
  ] as const) {
    await assert.rejects(
      ensureFirstUser(connection.database, settings, "UTC", clock, async () => {
        hashes++;
        return "unexpected-hash";
      }),
      { message },
    );
  }
  assert.equal(hashes, 0);
  assert.deepEqual(countUsers(connection.database), { count: 0 });
});

test("overlapping bootstrap attempts on separate connections create exactly one administrator", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "tare-bootstrap-overlap-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "engine.sqlite");
  const first = openDatabase(databasePath);
  const second = openDatabase(databasePath);
  context.after(first.close);
  context.after(second.close);
  let hashCalls = 0;
  let release!: () => void;
  const bothHashing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hasher = async (password: string) => {
    assert.equal(first.database.inTransaction, false);
    assert.equal(second.database.inTransaction, false);
    hashCalls++;
    if (hashCalls === 2) release();
    await bothHashing;
    return `invented-hash-for-${password}`;
  };
  await Promise.all([
    ensureFirstUser(
      first.database,
      { username: "first-example", password: "first-invented-password" },
      "UTC",
      clock,
      hasher,
    ),
    ensureFirstUser(
      second.database,
      { username: "second-example", password: "second-invented-password" },
      "UTC",
      clock,
      hasher,
    ),
  ]);
  assert.equal(hashCalls, 2);
  assert.deepEqual(countUsers(first.database), { count: 1 });
  const account = selectUser(first.database, { id: 1 });
  assert.ok(account);
  assert.equal(account.is_admin, 1);
  assert.ok(["first-example", "second-example"].includes(account.username));
});

test("failed hashing leaves no user and permits a later bootstrap", async (context) => {
  const connection = openDatabase(":memory:");
  context.after(connection.close);
  await assert.rejects(
    ensureFirstUser(connection.database, firstUser, "UTC", clock, async () => {
      throw new Error("Hash unavailable");
    }),
    /Hash unavailable/,
  );
  assert.deepEqual(countUsers(connection.database), { count: 0 });
  assert.equal(connection.database.inTransaction, false);
  await ensureFirstUser(
    connection.database,
    firstUser,
    "UTC",
    clock,
    async () => "invented-test-hash",
  );
  assert.deepEqual(countUsers(connection.database), { count: 1 });
});

test("engine process refuses an empty database without admin settings before listening", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "tare-bootstrap-process-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "engine.sqlite");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databasePath,
    TARE_TIMEZONE: "UTC",
    PORT: "3000",
  };
  delete environment.TARE_ADMIN_USERNAME;
  delete environment.TARE_ADMIN_PASSWORD;
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: new URL("../", import.meta.url),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 1);
  assert.match(
    stderr,
    /No users exist\. Set TARE_ADMIN_USERNAME and TARE_ADMIN_PASSWORD to create the first administrator\./,
  );
  assert.equal(stdout, "");
  const connection = openDatabase(databasePath);
  context.after(connection.close);
  assert.deepEqual(countUsers(connection.database), { count: 0 });
  assert.deepEqual(
    connection.database.prepare("SELECT * FROM job_runs").all(),
    [],
  );
});
