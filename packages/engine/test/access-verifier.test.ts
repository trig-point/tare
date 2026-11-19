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
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import {
  accessFixture,
  accessPublicJwk,
  assertionHeader,
  issuedAt,
  publicUser,
  rejection,
  signAccessToken,
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
    "absent sub is a service identity",
    { common_name: "agent" },
    403,
    "unknown_agent",
  ],
  [
    "absent sub reaches mapped person",
    { common_name: "example-agent" },
    200,
    "",
  ],
  [
    "absent sub permits browser",
    { common_name: "agent", email: "admin@example.com" },
    200,
    "",
  ],
  [
    "nonempty sub without email rejects service",
    { sub: "person", common_name: "agent" },
    401,
    "unauthenticated",
  ],
  [
    "absent sub with empty email rejects service",
    { common_name: "agent", email: "" },
    401,
    "unauthenticated",
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
    const mappedAgent = payload.common_name === "example-agent";
    if (mappedAgent)
      insertAgentToken(setup.database, {
        client_id: "example-agent",
        user_id: setup.admin.id,
        name: "Example agent",
        created_at: issuedAt.toISOString(),
      });
    const response = mappedAgent
      ? await setup.app.request("/api/me", {
          headers: assertionHeader(await signAccessToken(payload)),
        })
      : await setup.session(payload);
    assert.equal(response.status, status);
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
