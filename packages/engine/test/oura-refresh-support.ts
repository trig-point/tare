import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { OperationError } from "../src/operations/registry.ts";
import { storeOuraConnection } from "../src/oura/connections.ts";
import { decryptPair } from "../src/oura/encryption.ts";
import type { TokenTransport } from "../src/oura/provider.ts";
import { createOura, type OuraService } from "../src/oura/service.ts";
import { insertAccount } from "../src/queries/insert-account.ts";
import { selectConnection } from "../src/queries/oura/select-connection.ts";

export const key = Buffer.alloc(32, 9);
export const origin = Date.parse("2026-01-01T00:00:00.000Z");
export const canary = "invented-TOKEN-CANARY";
export function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function setup(context: TestContext) {
  const connection = openDatabase(":memory:");
  const database = connection.database;
  const config = loadConfig({
    DATABASE_URL: ":memory:",
    TARE_OURA_CLIENT_ID: "invented-client",
    TARE_OURA_CLIENT_SECRET: "invented-secret",
    TARE_OURA_REDIRECT_URL: "https://example.test/callback",
    TARE_OURA_TOKEN_KEY: key.toString("base64"),
  });
  let now = origin;
  const clock = { now: () => new Date(now) };
  const services: OuraService[] = [];
  const consumed = new Set<string>();
  let grants = 0;
  let respond: (
    body: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Response> = async (body) => Response.json(body);
  const transport: TokenTransport = async (_url, options) => {
    assert.equal(database.inTransaction, false);
    const fields = new URLSearchParams(options.body);
    assert.equal(fields.get("grant_type"), "refresh_token");
    assert.equal(fields.get("client_id"), "invented-client");
    assert.equal(fields.get("client_secret"), "invented-secret");
    const token = fields.get("refresh_token") as string;
    grants++;
    if (consumed.has(token))
      return Response.json(
        { error: "invalid_grant", error_description: canary },
        { status: 400 },
      );
    consumed.add(token);
    return respond(
      {
        access_token: `access-${grants}`,
        refresh_token: `refresh-${grants}`,
        token_type: "Bearer",
        expires_in: 3600,
      },
      options.signal as AbortSignal,
    );
  };
  const service = (
    overrides: Partial<Parameters<typeof createOura>[0]> = {},
  ) => {
    const created = createOura({
      database,
      config,
      clock,
      transport,
      ...overrides,
    });
    services.push(created);
    return created;
  };
  const seed = (
    owner = 1,
    generation = 0,
    expiresAt = new Date(origin).toISOString(),
  ) => {
    if (generation === 0)
      assert.ok(
        insertAccount(database, {
          username: `invented-${owner}`,
          password_hash: "invented",
          access_email: null,
          timezone: "UTC",
          is_admin: 0,
          created_at: clock.now().toISOString(),
        }),
      );
    assert.ok(
      storeOuraConnection(
        database,
        owner,
        generation,
        {
          pair: {
            access_token: `old-access-${owner}`,
            refresh_token: `old-refresh-${owner}`,
          },
          expiresAt,
          scope: "daily",
        },
        key,
        clock.now(),
      ),
    );
  };
  const row = (owner = 1) => selectConnection(database, { user_id: owner });
  const pair = (owner = 1) => {
    const stored = row(owner);
    return stored ? decryptPair(stored, owner, key) : null;
  };
  context.after(async () => {
    await Promise.all(services.map((created) => created.stop()));
    connection.close();
  });
  return {
    database,
    config,
    clock,
    service,
    seed,
    row,
    pair,
    grants: () => grants,
    setTime: (value: number) => {
      now = value;
    },
    respond: (value: typeof respond) => {
      respond = value;
    },
  };
}
export async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "success";
  } catch (error) {
    assert.ok(error instanceof OperationError);
    assert.equal(error.message, error.code);
    assert.deepEqual(error.headers, {});
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(canary));
    return `${error.status}:${error.code}`;
  }
}
