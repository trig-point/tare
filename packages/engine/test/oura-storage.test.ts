import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { agentOperations, operations } from "../src/operations/index.ts";
import {
  readOuraConnection,
  storeOuraConnection,
} from "../src/oura/connections.ts";
import { decryptPair, encryptPair } from "../src/oura/encryption.ts";
import { selectConnection } from "../src/queries/oura/select-connection.ts";
import {
  assertionHeader,
  cookie,
  dummyHash,
  issuedAt,
  keySet,
  signAccessToken,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const appEnv = {
  TARE_OURA_CLIENT_ID: "invented-client",
  TARE_OURA_CLIENT_SECRET: "invented-secret",
  TARE_OURA_REDIRECT_URL: "https://tare.example.test/api/oura/callback",
};
const key = Buffer.alloc(32, 7);
const pair = {
  access_token: "invented-access",
  refresh_token: "invented-refresh",
};
const grant = { pair, expiresAt: "2026-01-01T01:00:00.000Z" };
const parse = (env: Record<string, string | undefined>) =>
  loadConfig({ DATABASE_URL: ":memory:", ...env });
const status = (read: ReturnType<typeof readOuraConnection>) => [
  read.configured,
  read.status,
  read.credentials,
  read.reconnect_required,
];

test("Oura config trims optional groups and rejects supplied invalid settings", () => {
  for (const blank of [undefined, "", "  "]) {
    const config = parse(
      Object.fromEntries(
        [...Object.keys(appEnv), "TARE_OURA_TOKEN_KEY"].map((name) => [
          name,
          blank,
        ]),
      ),
    );
    assert.equal(config.oura, null);
    assert.equal(config.ouraTokenKey, undefined);
  }
  for (const mask of [1, 2, 3, 4, 5, 6]) {
    const values = Object.fromEntries(
      Object.entries(appEnv).map(([name, value], index) => [
        name,
        mask & (1 << index) ? value : " ",
      ]),
    );
    assert.throws(() => parse(values), {
      message:
        /^(TARE_OURA_CLIENT_ID|TARE_OURA_CLIENT_SECRET|TARE_OURA_REDIRECT_URL) must be set when Oura is configured$/,
    });
  }
  assert.deepEqual(
    parse(
      Object.fromEntries(
        Object.entries(appEnv).map(([name, value]) => [name, ` ${value} `]),
      ),
    ).oura,
    {
      clientId: appEnv.TARE_OURA_CLIENT_ID,
      clientSecret: appEnv.TARE_OURA_CLIENT_SECRET,
      redirectUrl: appEnv.TARE_OURA_REDIRECT_URL,
    },
  );
  for (const value of [
    "bad",
    ...[31, 33].map((size) => Buffer.alloc(size).toString("base64")),
    key.toString("base64").slice(0, -1),
  ])
    assert.throws(() => parse({ TARE_OURA_TOKEN_KEY: value }), {
      message: /^TARE_OURA_TOKEN_KEY /,
    });
  for (const url of [
    "/relative",
    "ftp://example.test",
    "https://example.test/#fragment",
    "https://example.test/#",
  ])
    assert.throws(() => parse({ ...appEnv, TARE_OURA_REDIRECT_URL: url }), {
      message: /^TARE_OURA_REDIRECT_URL /,
    });
  assert.deepEqual(
    parse({ TARE_OURA_TOKEN_KEY: ` ${key.toString("base64")} ` }).ouraTokenKey,
    key,
  );
});

test("Oura encryption authenticates owner, version, tag, ciphertext and key", () => {
  const envelope = encryptPair(pair, 1, key);
  assert.deepEqual(decryptPair(envelope, 1, key), pair);
  assert.notEqual(encryptPair(pair, 1, key).iv, envelope.iv);
  assert.equal(Buffer.from(envelope.iv, "base64").length, 12);
  assert.equal(Buffer.from(envelope.tag, "base64").length, 16);
  for (const secret of [undefined, Buffer.alloc(32, 8)])
    assert.equal(decryptPair(envelope, 1, secret), null);
  assert.equal(decryptPair(envelope, 2, key), null);
  for (const changed of [
    { version: 2 },
    { tag: Buffer.alloc(16).toString("base64") },
    { ciphertext: Buffer.alloc(20).toString("base64") },
  ])
    assert.equal(decryptPair({ ...envelope, ...changed }, 1, key), null);
});

for (const mode of ["access", "fallback"] as const)
  test(`Oura metadata is browser-only, strict and person-bound (${mode})`, async (context) => {
    const setup = await twoUsers(context, mode);
    const owner = setup.admin.user.id as number;
    const config = {
      ...parse(appEnv),
      identity:
        mode === "access"
          ? {
              mode,
              teamDomain: "https://example-team.cloudflareaccess.com",
              audience: "example-audience",
            }
          : { mode },
      ouraTokenKey: key,
    };
    const app = createApp({
      database: setup.database,
      config,
      clock: { now: () => issuedAt },
      dummyHash,
      accessKeySet: keySet,
      verifyPassword: async () => false,
    });
    const headers =
      mode === "access"
        ? assertionHeader(await signAccessToken())
        : { Cookie: cookie(await setup.signIn(setup.admin.credentials)) };
    assert.equal((await app.request("/api/oura")).status, 401);
    for (const [index, scope] of [
      " daily workout daily ",
      "daily",
      undefined,
    ].entries()) {
      assert.ok(
        storeOuraConnection(
          setup.database,
          owner,
          index,
          { ...grant, ...(scope === undefined ? {} : { scope }) },
          key,
          issuedAt,
        ),
      );
      const response = await app.request("/api/oura", { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      const body = await response.json();
      assert.deepEqual(body, {
        configured: true,
        status: "connected",
        credentials: "readable",
        reconnect_required: false,
        scopes: scope === "daily" ? ["daily"] : ["daily", "workout"],
        scope_source: scope === undefined ? "requested" : "response",
        access_expires_at: grant.expiresAt,
        last_synced_at: null,
      });
      for (const secret of [
        ...Object.values(pair),
        appEnv.TARE_OURA_CLIENT_SECRET,
        key.toString("base64"),
      ])
        assert.ok(!JSON.stringify(body).includes(secret));
    }
    assert.equal(
      (await (await setup.member.request("/api/oura")).json()).status,
      null,
    );
    const operation = operations.find(
      (entry) => entry.name === "read_oura_connection",
    );
    assert.ok(operation);
    assert.equal(operation.callerClass, "browser");
    assert.ok(!agentOperations.includes(operation));
    assert.equal(operation.input.safeParse({ user_id: owner }).success, false);
    assert.equal(
      operation.output.safeParse({
        ...readOuraConnection(setup.database, owner, key, true),
        access_token: pair.access_token,
      }).success,
      false,
    );
  });

test("Oura compare-and-swap preserves newer pairs and last-sync metadata", async (context) => {
  const setup = await twoUsers(context, "access");
  const owner = setup.admin.user.id as number;
  const save = (generation: number) =>
    storeOuraConnection(
      setup.database,
      owner,
      generation,
      grant,
      key,
      issuedAt,
    );
  assert.equal(save(1), false);
  assert.ok(save(0));
  const initial = selectConnection(setup.database, { user_id: owner });
  assert.ok(initial);
  assert.deepEqual(decryptPair(initial, owner, key), pair);
  assert.equal(save(0), false);
  assert.deepEqual(
    selectConnection(setup.database, { user_id: owner }),
    initial,
  );
  setup.database
    .prepare(
      "UPDATE oura_connections SET last_synced_at = ?, status = 'membership_required' WHERE user_id = ?",
    )
    .run(issuedAt.toISOString(), owner);
  assert.ok(save(1));
  const updated = selectConnection(setup.database, { user_id: owner });
  assert.ok(updated);
  assert.equal(updated.generation, 2);
  assert.notEqual(updated.iv, initial.iv);
  assert.equal(updated.last_synced_at, issuedAt.toISOString());
  assert.equal(save(1), false);
  assert.deepEqual(
    selectConnection(setup.database, { user_id: owner }),
    updated,
  );
  setup.database.exec(
    "CREATE TRIGGER fail_oura BEFORE UPDATE ON oura_connections BEGIN SELECT RAISE(ABORT, 'invented-db-error'); END",
  );
  assert.throws(() => save(2));
  assert.deepEqual(
    selectConnection(setup.database, { user_id: owner }),
    updated,
  );
  assert.throws(
    () => storeOuraConnection(setup.database, 999, 0, grant, key, issuedAt),
    /FOREIGN KEY/,
  );
});

test("Oura real file restores preserve all rows with right, missing, wrong then right keys", async (context) => {
  const setup = await twoUsers(context, "access");
  const owner = setup.admin.user.id as number;
  assert.ok(
    storeOuraConnection(setup.database, owner, 0, grant, key, issuedAt),
  );
  setup.database
    .prepare(
      "UPDATE oura_connections SET status = 'membership_required' WHERE user_id = ?",
    )
    .run(owner);
  setup.database
    .prepare(
      "INSERT INTO intake_entries (user_id, client_id, eaten_at, day, kcal, provenance, created_at, updated_at) VALUES (?, 'invented-intake', ?, '2026-01-01', 500, 'label', ?, ?)",
    )
    .run(
      owner,
      issuedAt.toISOString(),
      issuedAt.toISOString(),
      issuedAt.toISOString(),
    );
  setup.database
    .prepare(
      "INSERT INTO weights (user_id, client_id, measured_at, day, weight_kg, created_at) VALUES (?, 'invented-weight', ?, '2026-01-01', 80, ?)",
    )
    .run(owner, issuedAt.toISOString(), issuedAt.toISOString());
  setup.database
    .prepare(
      "INSERT INTO daily_signals VALUES (?, '2026-01-01', 'steps', 1000, 'manual', ?)",
    )
    .run(owner, issuedAt.toISOString());
  const snapshot = (database: typeof setup.database) => [
    database.prepare("SELECT * FROM oura_connections").all(),
    database.prepare("SELECT * FROM intake_entries").all(),
    database.prepare("SELECT * FROM weights").all(),
    database.prepare("SELECT * FROM daily_signals").all(),
  ];
  const before = snapshot(setup.database);
  const directory = await mkdtemp(join(tmpdir(), "tare-oura-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "backup.sqlite");
  await setup.database.backup(file);
  const captured: unknown[] = [];
  for (const method of ["error", "warn", "info", "log"] as const)
    context.mock.method(console, method, (...args: unknown[]) => {
      captured.push(args);
    });
  for (const secret of [key, undefined, Buffer.alloc(32, 8), key]) {
    const restored = openDatabase(file);
    try {
      const read = readOuraConnection(restored.database, owner, secret, true);
      assert.deepEqual(status(read), [
        secret !== undefined,
        "membership_required",
        secret === key ? "readable" : "unreadable",
        secret !== key,
      ]);
      assert.deepEqual(snapshot(restored.database), before);
    } finally {
      restored.close();
    }
  }
  assert.deepEqual(captured, []);
  const other = setup.member.user.id as number;
  assert.ok(
    storeOuraConnection(setup.database, other, 0, grant, key, issuedAt),
  );
  const state = setup.database.prepare(
    "INSERT INTO oura_states VALUES ('invented-state-hash', ?, 'invented-verifier', 1, ?, ?)",
  );
  assert.throws(
    () => state.run(999, issuedAt.toISOString(), grant.expiresAt),
    /FOREIGN KEY/,
  );
  state.run(other, issuedAt.toISOString(), grant.expiresAt);
  setup.database.prepare("DELETE FROM users WHERE id = ?").run(other);
  for (const table of ["oura_states", "oura_connections"])
    assert.equal(
      (
        setup.database
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE user_id = ?`)
          .get(other) as { count: number }
      ).count,
      0,
    );
});
