import assert from "node:assert/strict";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { normalizeAccessEmail } from "../src/auth/access.ts";
import { countUsers } from "../src/queries/count-users.ts";
import {
  accessFixture,
  accessPublicJwk,
  assertionHeader,
  issuedAt,
  publicUser,
  rejection,
} from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const cases: [string, JWTPayload, number, string][] = [
  ["known email", { email: "admin@example.com" }, 200, ""],
  ["padded mixed-case email", { email: " ADMIN@EXAMPLE.COM " }, 200, ""],
  ["unknown email", { email: "unknown@example.com" }, 403, "not_a_member"],
  [
    "service with email",
    { sub: "", common_name: "agent", email: "admin@example.com" },
    403,
    "unknown_agent",
  ],
  [
    "absent sub is no service identity",
    { common_name: "agent" },
    401,
    "unauthenticated",
  ],
  [
    "absent sub permits browser",
    { common_name: "agent", email: "admin@example.com" },
    200,
    "",
  ],
  [
    "nonempty sub permits browser",
    { sub: "person", common_name: "agent", email: "admin@example.com" },
    200,
    "",
  ],
  [
    "empty common name permits browser",
    { sub: "", common_name: "", email: "admin@example.com" },
    200,
    "",
  ],
  ["neither identity shape", {}, 401, "unauthenticated"],
  ["blank email", { email: "   " }, 401, "unauthenticated"],
  ["non-string email", { email: 42 }, 401, "unauthenticated"],
  [
    "empty service fields",
    { sub: "", common_name: "" },
    401,
    "unauthenticated",
  ],
  [
    "wrong audience",
    { email: "admin@example.com", aud: "other" },
    401,
    "unauthenticated",
  ],
  [
    "wrong issuer",
    { email: "admin@example.com", iss: "https://other.example.com" },
    401,
    "unauthenticated",
  ],
];
for (const [name, payload, status, code] of cases) {
  test(`Access token: ${name}`, async (context) => {
    const setup = accessFixture(context);
    const response = await setup.session(payload);
    if (status === 200)
      assert.equal((await publicUser(response)).id, setup.admin.id);
    else await rejection(response, status, code);
    assert.deepEqual(countUsers(setup.database), { count: 1 });
  });
}

test("verifier requires expiry and rejects expired tokens on a stepped clock", async (context) => {
  const setup = accessFixture(context);
  await rejection(
    await setup.session(undefined, false),
    401,
    "unauthenticated",
  );
  assert.equal((await setup.session()).status, 200);
  setup.setNow("2026-01-01T00:01:00.000Z");
  await rejection(await setup.session(), 401, "unauthenticated");
});

const signAs = (privateKey: CryptoKey, alg: string) =>
  new SignJWT({ email: "admin@example.com" })
    .setProtectedHeader({ alg, kid: "example-key" })
    .setIssuer("https://example-team.cloudflareaccess.com")
    .setAudience("example-audience")
    .setExpirationTime(issuedAt.getTime() / 1000 + 60)
    .sign(privateKey);

test("verifier rejects malformed and forged signatures and pins RS256", async (context) => {
  const forger = await generateKeyPair("RS256");
  const ellipticKeys = await generateKeyPair("ES256");
  // The EC key shares the kid so only the RS256 pin can reject the ES256 token.
  const withEllipticKey = createLocalJWKSet({
    keys: [
      accessPublicJwk,
      {
        ...(await exportJWK(ellipticKeys.publicKey)),
        kid: "example-key",
        alg: "ES256",
      },
    ],
  });
  const setup = accessFixture(context, withEllipticKey);
  assert.equal((await setup.session()).status, 200);
  for (const [name, token] of [
    ["empty", ""],
    ["malformed", "malformed"],
    ["forged signature", await signAs(forger.privateKey, "RS256")],
    ["ES256", await signAs(ellipticKeys.privateKey, "ES256")],
  ]) {
    await context.test(name as string, async () => {
      await rejection(
        await setup.app.request("/api/session", {
          headers: assertionHeader(token as string),
        }),
        401,
        "unauthenticated",
      );
    });
  }
  assert.equal(
    normalizeAccessEmail(" ÄDMIN@EXAMPLE.COM "),
    "ädmin@example.com",
  );
  assert.equal(normalizeAccessEmail(" "), null);
});
