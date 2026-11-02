import assert from "node:assert/strict";
import {
  ensureFirstUser,
  ensureSignInCapableUsers,
} from "../src/auth/bootstrap.ts";
import { type Config, loadConfig } from "../src/config.ts";
import { selectUser } from "../src/queries/select-user.ts";
import {
  accessConfig,
  accessFixture,
  issuedAt,
  publicUser,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

test("Access first administrator has normalized email, no password and authenticates as admin", async (context) => {
  const setup = accessFixture(context);
  const { database } = setup;
  database.prepare("DELETE FROM users").run();
  const ensure = (settings: Config["firstUser"]) =>
    ensureFirstUser(
      database,
      settings,
      "UTC",
      { now: () => issuedAt },
      async () => {
        throw new Error("Access must not hash");
      },
      accessConfig.identity,
    );
  for (const accessEmail of [undefined, "", " "])
    await assert.rejects(
      ensure({ username: "example-admin", password: undefined, accessEmail }),
      /TARE_ADMIN_ACCESS_EMAIL/,
    );
  await assert.rejects(
    ensure({
      username: undefined,
      password: undefined,
      accessEmail: "admin@example.com",
    }),
    /TARE_ADMIN_USERNAME/,
  );
  await ensure({
    username: "example-admin",
    password: undefined,
    accessEmail: " ADMIN@EXAMPLE.COM ",
  });
  const account = selectUser(database, { id: 1 });
  assert.equal(account?.access_email, "admin@example.com");
  assert.equal(account?.password_hash, null);
  ensureSignInCapableUsers(database, accessConfig.identity);
  assert.throws(
    () => ensureSignInCapableUsers(database, { mode: "fallback" }),
    /set up in access mode/,
  );
  assert.equal((await publicUser(await setup.session())).is_admin, true);
  database
    .prepare("UPDATE users SET access_email = NULL, password_hash = ?")
    .run("invented-hash");
  ensureSignInCapableUsers(database, { mode: "fallback" });
  assert.throws(
    () => ensureSignInCapableUsers(database, accessConfig.identity),
    /set up in fallback mode/,
  );
});

const configure = (settings: Record<string, string | undefined>) =>
  loadConfig({ DATABASE_URL: ":memory:", ...settings });
const domains = [
  "bad",
  "http://example.com",
  "https://example.com/path",
  "https://example.com/",
  "https://example.com?query",
  "https://user:password@example.com",
  "https://example.com:443",
];
for (const domain of domains) {
  test(`Access config rejects domain ${domain}`, () => {
    assert.throws(
      () =>
        configure({ TARE_ACCESS_TEAM_DOMAIN: domain, TARE_ACCESS_AUD: "aud" }),
      /TARE_ACCESS_TEAM_DOMAIN/,
    );
  });
}
for (const [name, settings, expected] of [
  [
    "missing audience",
    { TARE_ACCESS_TEAM_DOMAIN: "https://example.com" },
    /TARE_ACCESS_AUD/,
  ],
  ["missing domain", { TARE_ACCESS_AUD: "aud" }, /TARE_ACCESS_TEAM_DOMAIN/],
] as const) {
  test(`Access config: ${name}`, () => {
    assert.throws(() => configure(settings), expected);
  });
}
test("Access config treats blanks as unset and normalizes configured values", () => {
  for (const blank of [undefined, "", "  "])
    assert.deepEqual(
      configure({ TARE_ACCESS_TEAM_DOMAIN: blank, TARE_ACCESS_AUD: blank })
        .identity,
      { mode: "fallback" },
    );
  const config = configure({
    TARE_ACCESS_TEAM_DOMAIN: " https://example.com ",
    TARE_ACCESS_AUD: " aud ",
    TARE_ADMIN_ACCESS_EMAIL: " ADMIN@EXAMPLE.COM ",
  });
  assert.deepEqual(config.identity, {
    mode: "access",
    teamDomain: "https://example.com",
    audience: "aud",
  });
  assert.equal(config.firstUser.accessEmail, "admin@example.com");
});
