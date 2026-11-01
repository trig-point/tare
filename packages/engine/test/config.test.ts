import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

test("first user settings trim only the username and preserve password spaces", () => {
  assert.deepEqual(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_ADMIN_USERNAME: "  Example-Admin  ",
      TARE_ADMIN_PASSWORD: "  invented-password  ",
    }).firstUser,
    { username: "Example-Admin", password: "  invented-password  " },
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
      { username: undefined, password: undefined },
    );
  }
  assert.deepEqual(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_ADMIN_USERNAME: "Example-Admin",
    }).firstUser,
    { username: "Example-Admin", password: undefined },
  );
  assert.deepEqual(
    loadConfig({ DATABASE_URL: ":memory:", TARE_ADMIN_PASSWORD: " " })
      .firstUser,
    { username: undefined, password: " " },
  );
  assert.deepEqual(
    loadConfig({
      DATABASE_URL: ":memory:",
      TARE_ADMIN_USERNAME: "x".repeat(65),
      TARE_ADMIN_PASSWORD: "x".repeat(1025),
    }).firstUser,
    { username: "x".repeat(65), password: "x".repeat(1025) },
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
