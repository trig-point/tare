import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import {
  hashPassword,
  isValidPassword,
  normalizeUsername,
  verifyPassword,
} from "../src/auth/password.ts";

test("password hashes round trip with random salts and the required format", async () => {
  const password = "invented-test-password";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(
    first,
    /^scrypt\$N=32768,r=8,p=3\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
  );
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-test-password", first), false);
});

test("password bytes preserve surrounding spaces and Unicode normalization", async () => {
  const password = "  invented-cafe\u0301  ";
  const stored = await hashPassword(password);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword(password.trim(), stored), false);
  assert.equal(await verifyPassword(password.normalize("NFC"), stored), false);
});

test("malformed stored hashes return false without throwing or deriving", async (context) => {
  const derivation = context.mock.method(crypto, "scrypt", () => {
    throw new Error("Unexpected derivation");
  });
  syncBuiltinESMExports();
  context.after(() => {
    derivation.mock.restore();
    syncBuiltinESMExports();
  });
  const salt = Buffer.alloc(16).toString("base64url");
  const key = Buffer.alloc(32).toString("base64url");
  const format = (saltText: string, keyText: string) =>
    `scrypt$N=32768,r=8,p=3$${saltText}$${keyText}`;
  for (const stored of [
    `scrypt$N=16384,r=8,p=3$${salt}$${key}`,
    `other$N=32768,r=8,p=3$${salt}$${key}`,
    ...[15, 17].map((length) =>
      format(Buffer.alloc(length).toString("base64url"), key),
    ),
    ...[31, 33].map((length) =>
      format(salt, Buffer.alloc(length).toString("base64url")),
    ),
    format(`${salt}==`, key),
    format(salt, `${key}=`),
    format(`${salt.slice(0, -1)}B`, key),
    format(salt, `${key.slice(0, -1)}B`),
    format(`${salt}!`, key),
    format(`${salt.slice(0, 11)}!${salt.slice(11)}`, key),
    format(salt, `${key.slice(0, 21)}!${key.slice(21)}`),
    format(salt, `${key}\n`),
    "",
    `scrypt$N=32768,r=8,p=3$${salt}`,
    `${format(salt, key)}$extra`,
  ]) {
    assert.equal(
      await verifyPassword("invented-test-password", stored),
      false,
      stored,
    );
  }
  assert.equal(derivation.mock.callCount(), 0);
  assert.equal(
    await verifyPassword("invented-test-password", format(salt, key)),
    false,
  );
  assert.equal(derivation.mock.callCount(), 1);
  assert.deepEqual(derivation.mock.calls[0]?.arguments[3], {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
});

test("shared input limits reject nonstrings and preserve valid inputs", () => {
  for (const password of [undefined, null, 1, "", "x".repeat(1025)])
    assert.equal(isValidPassword(password), false);
  for (const password of [" ", "x", "x".repeat(1024)])
    assert.equal(isValidPassword(password), true);
  for (const username of [undefined, null, 1, "", "   ", "x".repeat(65)])
    assert.equal(normalizeUsername(username), null);
  assert.equal(normalizeUsername("  Sample-User  "), "Sample-User");
  assert.equal(normalizeUsername("x".repeat(64)), "x".repeat(64));
});

test("invalid password lengths cannot be hashed or verified", async (context) => {
  const candidate = "invented-test-password";
  const stored = await hashPassword(candidate);
  const derivation = context.mock.method(crypto, "scrypt");
  syncBuiltinESMExports();
  context.after(() => {
    derivation.mock.restore();
    syncBuiltinESMExports();
  });
  for (const password of ["", "x".repeat(1025)]) {
    await assert.rejects(hashPassword(password), /Invalid password length/);
    assert.equal(await verifyPassword(password, stored), false);
    assert.equal(derivation.mock.callCount(), 0);
  }
  assert.equal(await verifyPassword(candidate, stored), true);
  assert.equal(derivation.mock.callCount(), 1);
});
