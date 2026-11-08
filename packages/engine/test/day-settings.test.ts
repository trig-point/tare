import assert from "node:assert/strict";
import { assertionHeader, rejection, signAccessToken } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const save = (body: unknown) => ({
  method: "PATCH",
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("day settings save for the caller only and apply to new entries", async (context) => {
  const setup = await twoUsers(context, "fallback");
  const { admin, member } = setup;
  const log = async (client_id: string) => {
    const response = await admin.request("/api/intake", {
      method: "POST",
      body: JSON.stringify({ client_id, name: "Example meal", kcal: 100 }),
    });
    assert.equal(response.status, 201);
  };
  const days = () =>
    setup.database
      .prepare("SELECT client_id, day FROM intake_entries ORDER BY id")
      .all();
  await log("example-before");
  const saved = await admin.request(
    "/api/me",
    save({ timezone: " America/New_York ", day_start_hour: 6 }),
  );
  assert.equal(saved.status, 200);
  const expected = {
    ...admin.user,
    timezone: "America/New_York",
    day_start_hour: 6,
  };
  assert.deepEqual((await saved.json()).user, expected);
  assert.deepEqual(
    (await (await admin.request("/api/me")).json()).user,
    expected,
  );
  await log("example-after");
  assert.deepEqual(days(), [
    { client_id: "example-before", day: "2026-01-01" },
    { client_id: "example-after", day: "2025-12-31" },
  ]);
  const memberSave = await member.request(
    "/api/me",
    save({ timezone: "Europe/Paris", day_start_hour: 0, id: admin.user.id }),
  );
  await rejection(memberSave, 400, "invalid_request");
  assert.equal(
    (
      await member.request(
        "/api/me",
        save({ timezone: "Europe/Paris", day_start_hour: 0 }),
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await (await admin.request("/api/me")).json()).user,
    expected,
  );
  assert.deepEqual((await (await member.request("/api/me")).json()).user, {
    ...member.user,
    timezone: "Europe/Paris",
    day_start_hour: 0,
  });
  for (const invalid of [
    "{",
    "[]",
    {},
    { timezone: "Not/AZone", day_start_hour: 4 },
    { timezone: "+05:00", day_start_hour: 4 },
    { timezone: " ", day_start_hour: 4 },
    { timezone: "UTC", day_start_hour: 24 },
    { timezone: "UTC", day_start_hour: 1.5 },
    { timezone: "UTC" },
  ])
    await rejection(
      await admin.request("/api/me", save(invalid)),
      400,
      "invalid_request",
    );
  await rejection(
    await setup.app.request("/api/me", save(expected)),
    401,
    "unauthenticated",
  );
});

test("agent service tokens cannot change day settings", async (context) => {
  const setup = await twoUsers(context, "access");
  const created = await setup.admin.request("/api/agent-tokens", {
    method: "POST",
    body: JSON.stringify({
      client_id: "Invented-Agent",
      user_id: setup.admin.user.id,
      name: "Agent",
    }),
  });
  assert.equal(created.status, 201);
  const headers = {
    ...assertionHeader(
      await signAccessToken({ sub: "", common_name: "Invented-Agent" }),
    ),
    "X-Requested-With": "XMLHttpRequest",
  };
  const denied = await setup.app.request("/api/me", {
    ...save({ timezone: "UTC", day_start_hour: 0 }),
    headers,
  });
  await rejection(denied, 403, "forbidden");
});
