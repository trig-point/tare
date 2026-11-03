import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { test as authTest } from "./support/hang-ceiling.ts";

test("adaptive settings default, reset, override and reject invalid values", () => {
  const cases = [
    ["TARE_TDEE_WINDOW_DAYS", "windowDays", 28, "35", ["13", "91", "14.5"]],
    [
      "TARE_TDEE_ENERGY_DENSITY",
      "energyDensity",
      7700,
      "7000",
      ["4999", "10001"],
    ],
    [
      "TARE_TDEE_MIN_SIGNED_DAYS",
      "minSignedDays",
      14,
      "10",
      ["0", "29", "1.5"],
    ],
    [
      "TARE_TDEE_MIN_WEIGH_IN_DAYS",
      "minWeighInDays",
      8,
      "6",
      ["0", "29", "1.5"],
    ],
    ["TARE_TDEE_MIN_SPAN_DAYS", "minSpanDays", 14, "20", ["0", "29", "1.5"]],
    ["TARE_TDEE_DEFAULT_RANGE", "defaultRange", 0.25, "0.1", ["-0.1", "0.91"]],
  ] as const;
  for (const [name, key, fallback, override, invalid] of cases) {
    const read = (value: string | undefined) =>
      loadConfig({ DATABASE_URL: ":memory:", [name]: value }).tdee[key];
    for (const empty of [undefined, "", " "])
      assert.equal(read(empty), fallback);
    assert.equal(read(` ${override} `), Number(override));
    for (const value of [...invalid, "text", "NaN", "Infinity"])
      assert.throws(() => read(value), new RegExp(name));
  }
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
