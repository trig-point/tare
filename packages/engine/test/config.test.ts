import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { test as authTest } from "./support/hang-ceiling.ts";

test("order model settings are all-or-none, trimmed, and validate the URL", () => {
  const configured = {
    TARE_ORDER_MODEL_BASE_URL: " https://model.example.test/v1 ",
    TARE_ORDER_MODEL: " fixture-model ",
    TARE_ORDER_MODEL_API_KEY: " fixture-key ",
  };
  const config = (values: Record<string, string | undefined>) =>
    loadConfig({ DATABASE_URL: ":memory:", ...values });
  assert.deepEqual(config(configured).orderModel, {
    baseURL: "https://model.example.test/v1",
    model: "fixture-model",
    apiKey: "fixture-key",
  });
  for (const value of [undefined, "", " "])
    assert.equal(
      config({
        TARE_ORDER_MODEL_BASE_URL: value,
        TARE_ORDER_MODEL: value,
        TARE_ORDER_MODEL_API_KEY: value,
      }).orderModel,
      null,
    );
  for (const setting of Object.keys(configured))
    assert.throws(
      () => config({ ...configured, [setting]: "" }),
      new RegExp(`${setting} must be set`),
    );
  for (const value of ["bad-url", "ftp://model.example.test"])
    assert.throws(
      () => config({ ...configured, TARE_ORDER_MODEL_BASE_URL: value }),
      /TARE_ORDER_MODEL_BASE_URL/,
    );
});

authTest("MCP origin config validates the allow list", () => {
  for (const [value, expected] of [
    [undefined, []],
    ["", []],
    [" ", []],
    [" https://a.test, http://b.test ", ["https://a.test", "http://b.test"]],
    ["https://app.example.test/path", null],
  ] as const) {
    const env = { DATABASE_URL: ":memory:", TARE_MCP_ALLOWED_ORIGINS: value };
    const read = () => loadConfig(env).mcpAllowedOrigins;
    if (expected === null) assert.throws(read, /TARE_MCP_ALLOWED_ORIGINS/);
    else assert.deepEqual(read(), expected);
  }
});

test("USDA API key is optional, trimmed, and empty counts as unset", () => {
  for (const value of [undefined, "", "   "])
    assert.equal(
      loadConfig({ DATABASE_URL: ":memory:", TARE_USDA_API_KEY: value })
        .usdaApiKey,
      undefined,
    );
  assert.equal(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_USDA_API_KEY: "  fixture-key  ",
    }).usdaApiKey,
    "fixture-key",
  );
});

authTest(
  "session config validates lifetime and URL and treats empty values as unset",
  () => {
    for (const value of [undefined, "", " "]) {
      const config = loadConfig({
        DATABASE_URL: ":memory:",
        TARE_SESSION_DAYS: value,
        TARE_PUBLIC_URL: value,
      });
      assert.equal(config.sessionDays, 30);
      assert.equal(config.publicUrl, undefined);
    }
    for (const value of ["0", "366", "1.5", "text"])
      assert.throws(
        () =>
          loadConfig({ DATABASE_URL: ":memory:", TARE_SESSION_DAYS: value }),
        /TARE_SESSION_DAYS/,
      );
    for (const value of ["not-a-url", "ftp://tare.example.test"])
      assert.throws(
        () => loadConfig({ DATABASE_URL: ":memory:", TARE_PUBLIC_URL: value }),
        /TARE_PUBLIC_URL/,
      );
    for (const value of ["1", "365"])
      assert.equal(
        loadConfig({ DATABASE_URL: ":memory:", TARE_SESSION_DAYS: value })
          .sessionDays,
        Number(value),
      );
  },
);

test("first user settings trim only the username and preserve password spaces", () => {
  assert.deepEqual(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_ADMIN_USERNAME: "  Example-Admin  ",
      TARE_ADMIN_PASSWORD: "  invented-password  ",
    }).firstUser,
    {
      accessEmail: undefined,
      username: "Example-Admin",
      password: "  invented-password  ",
    },
  );
});

test("first user settings carry absent, empty and half-set values without validation", () => {
  for (const settings of [
    {},
    { TARE_ADMIN_USERNAME: "", TARE_ADMIN_PASSWORD: "" },
    { TARE_ADMIN_USERNAME: "   " },
  ]) {
    assert.deepEqual(
      loadConfig({ DATABASE_URL: ":memory:", ...settings }).firstUser,
      { accessEmail: undefined, username: undefined, password: undefined },
    );
  }
  assert.deepEqual(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_ADMIN_USERNAME: "Example-Admin",
    }).firstUser,
    { accessEmail: undefined, username: "Example-Admin", password: undefined },
  );
  assert.deepEqual(
    loadConfig({ DATABASE_URL: ":memory:", TARE_ADMIN_PASSWORD: " " })
      .firstUser,
    { accessEmail: undefined, username: undefined, password: " " },
  );
  assert.deepEqual(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_ADMIN_USERNAME: "x".repeat(65),
      TARE_ADMIN_PASSWORD: "x".repeat(1025),
    }).firstUser,
    {
      accessEmail: undefined,
      username: "x".repeat(65),
      password: "x".repeat(1025),
    },
  );
});

test("timezone defaults to UTC independently of TZ", () => {
  assert.equal(
    loadConfig({ DATABASE_URL: ":memory:", TZ: "Pacific/Honolulu" }).timezone,
    "UTC",
  );
});

for (const timezone of ["", " ", "invalid/timezone", "+01:00"]) {
  test(`timezone rejects ${JSON.stringify(timezone)}`, () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: ":memory:", TARE_TIMEZONE: timezone }),
      /TARE_TIMEZONE/,
    );
  });
}

for (const timezone of ["UTC", "America/New_York", "Asia/Kolkata"]) {
  test(`timezone accepts ${timezone}`, () => {
    assert.equal(
      loadConfig({ DATABASE_URL: ":memory:", TARE_TIMEZONE: timezone })
        .timezone,
      timezone,
    );
  });
}
