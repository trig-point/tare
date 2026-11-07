import assert from "node:assert/strict";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

for (const mode of ["fallback", "access"] as const)
  test(`${mode}: person header protects both writes across an identity switch`, async (context) => {
    const { admin, member, database } = await twoUsers(context, mode);
    const session = await (await admin.request("/api/session")).json();
    for (const [path, table, fields] of [
      ["/api/intake", "intake_entries", { name: "Example snack", kcal: 100 }],
      ["/api/weights", "weights", { weight_kg: 70 }],
    ] as const) {
      for (const expectedPerson of [
        undefined,
        String(member.user.id),
        String(session.user.id),
        "",
      ]) {
        const client_id = `${path}-${expectedPerson ?? "absent"}`;
        const matches =
          expectedPerson === undefined ||
          expectedPerson === String(member.user.id);
        const response = await member.request(path, {
          method: "POST",
          headers:
            expectedPerson === undefined
              ? {}
              : { "X-Tare-Person": expectedPerson },
          body: JSON.stringify({ client_id, ...fields }),
        });
        assert.equal(response.status, matches ? 201 : 409);
        const body = await response.json();
        if (matches) assert.equal(body.entry.user_id, member.user.id);
        else assert.deepEqual(body, { error: { code: "person_mismatch" } });
        const query =
          table === "weights"
            ? "SELECT count(*) FROM weights WHERE client_id = ?"
            : "SELECT count(*) FROM intake_entries WHERE client_id = ?";
        assert.equal(
          database.prepare(query).pluck().get(client_id),
          matches ? 1 : 0,
        );
      }
    }
    const signIn = await admin.request("/api/sign-in", {
      headers: { "X-Tare-Person": String(member.user.id) },
    });
    assert.equal(signIn.status, 302);
    assert.equal(signIn.headers.get("Location"), "/");
  });
