import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

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
