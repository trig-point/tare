import assert from "node:assert/strict";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

type Person = Awaited<ReturnType<typeof twoUsers>>["admin"];
const windows = [0, 360, 720, 960, 1440];

async function planFor(person: Person) {
  const send = async (path: string, body: unknown) =>
    (
      await person.request(`/api/plan/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      })
    ).json();
  const { template } = await send("templates", {
    action: "create",
    name: "Example day",
    slots: [0, 1, 2, 3].map((position) => ({
      name: `Example ${position}`,
      start_minute: windows[position],
      end_minute: windows[position + 1],
      share: 25,
    })),
  });
  const { day_type } = await send("day-types", {
    action: "create",
    name: "Example type",
    template_id: template.id,
  });
  await send("default-day-type", { day_type_id: day_type.id });
  return async () =>
    (await (await person.request("/api/plan")).json()) as {
      suggested_shares: { share: number }[] | null;
      slots: { share_bp: number }[];
    };
}

test("suggested shares come from the person's own signed-off days", async (context) => {
  const { admin, member, database } = await twoUsers(context, "fallback");
  const [readAdmin, readMember] = [await planFor(admin), await planFor(member)];
  const insert = database.prepare(
    "INSERT INTO intake_entries (user_id, client_id, eaten_at, day, kcal, provenance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'estimated', ?, ?)",
  );
  const signOff = database.prepare(
    "INSERT INTO days (user_id, day, signed_off_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z') ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = excluded.signed_off_at",
  );
  const day = (index: number) =>
    `2025-11-${String(index + 1).padStart(2, "0")}`;
  for (let index = 0; index < 15; index += 1)
    for (const [hour, kcal] of [
      [3, index === 14 ? 9000 : 0],
      [9, 600],
      [13, 200],
      [19, 1200],
    ])
      insert.run(
        admin.user.id,
        `example-${index}-${hour}`,
        `${day(index)}T${String(hour).padStart(2, "0")}:00:00.000Z`,
        day(index),
        kcal,
        `${day(index)}T00:00:00.000Z`,
        `${day(index)}T00:00:00.000Z`,
      );
  for (let index = 0; index < 13; index += 1)
    signOff.run(admin.user.id, day(index));
  assert.equal((await readAdmin()).suggested_shares, null);
  signOff.run(admin.user.id, day(13));
  const offered = await readAdmin();
  assert.deepEqual(
    offered.suggested_shares?.map((value) => value.share),
    [1, 30, 10, 59],
  );
  assert.deepEqual(
    offered.slots.map((slot) => slot.share_bp),
    [2500, 2500, 2500, 2500],
  );
  for (let index = 0; index < 14; index += 1)
    signOff.run(member.user.id, day(index));
  assert.equal((await readMember()).suggested_shares, null);
});
