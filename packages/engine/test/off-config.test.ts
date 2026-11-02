import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";

test("OFF config accepts AppName/Version (ContactEmail) and rejects malformed values", () => {
  const config = (value: string | undefined) =>
    loadConfig({ DATABASE_URL: ":memory:", TARE_OFF_USER_AGENT: value });
  for (const value of [undefined, "", " "])
    assert.equal(config(value).offUserAgent, undefined);
  assert.equal(
    config(" Tare/1.0 (support@example.com) ").offUserAgent,
    "Tare/1.0 (support@example.com)",
  );
  for (const value of [
    "Tare",
    "Tare/1.0",
    "Tare/1.0 (contact)",
    "Tare/1.0 (a@b.c)\r\nInjected: yes",
  ])
    assert.throws(() => config(value), /TARE_OFF_USER_AGENT/);
});
