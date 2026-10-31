import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db";

describe("engine foundation", () => {
  test("health returns 200 and ok", async () => {
    const response = await createApp().request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("config rejects a missing required variable by name", () => {
    expect(() => loadConfig({})).toThrow("DATABASE_URL is required");
  });

  test("config reads a present required variable and defaults the port", () => {
    expect(loadConfig({ DATABASE_URL: ":memory:" })).toEqual({
      databaseUrl: ":memory:",
      port: 3000,
    });
  });

  test("migrations create the foundation table in memory", () => {
    const connection = openDatabase(":memory:");
    try {
      connection.database.run(sql`INSERT INTO foundation (id) VALUES (1)`);
      expect(connection.database.all(sql`SELECT id FROM foundation`)).toEqual([
        { id: 1 },
      ]);
    } finally {
      connection.close();
    }
  });
});
