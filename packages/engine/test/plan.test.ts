import assert from "node:assert/strict";
import { selectedTemplate } from "../src/plan/reader.ts";
import { test } from "./support/hang-ceiling.ts";
import { twoUsers } from "./support/two-users.ts";

const slots = (shares = [20, 30, 10, 40]) =>
  shares.map((share, position) => ({
    name: `Example slot ${position + 1}`,
    start_minute: position * (1440 / shares.length),
    end_minute: (position + 1) * (1440 / shares.length),
    share,
    fill_hint: "high protein; leftovers, not a tag",
  }));

for (const mode of ["fallback", "access"] as const) {
  test(`${mode}: template invariants reject invalid shares and windows before writing`, async (context) => {
    const { admin, database } = await twoUsers(context, mode);
    const original = slots();
    for (const [values, code] of [
      [slots([20, 20, 20, 20]), "invalid_template_shares"],
      [slots([0, 30, 30, 40]), "invalid_template_share"],
      [slots([-10, 40, 30, 40]), "invalid_template_share"],
      [
        [
          original[0],
          { ...original[1], start_minute: 10 },
          ...original.slice(2),
        ],
        "slot_windows_overlap",
      ],
      [[], "invalid_request"],
      [[{ ...original[0], share: 100.001 }], "invalid_request"],
      [[{ ...original[0], start_minute: -1 }], "invalid_request"],
      [[{ ...original[0], end_minute: 0 }], "invalid_request"],
      [[{ ...original[0], fill_hint: "x".repeat(201) }], "invalid_request"],
    ] as const) {
      const response = await admin.request("/api/plan/templates", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          name: "Example invalid",
          slots: values,
        }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code } });
    }
    assert.deepEqual(
      database.prepare("SELECT count(*) AS count FROM day_templates").get(),
      { count: 0 },
    );
  });

  test(`${mode}: template CRUD, manual and default plans, rollback and owner isolation`, async (context) => {
    const { admin, member, database } = await twoUsers(context, mode);
    const send = async (
      person: typeof admin,
      path: string,
      body?: unknown,
      status = 200,
      code?: string,
    ) => {
      const response = await person.request(
        `/api/plan/${path}`,
        body === undefined
          ? {}
          : { method: "POST", body: JSON.stringify(body) },
      );
      assert.equal(response.status, status);
      const result = await response.json();
      if (code) assert.deepEqual(result, { error: { code } });
      return result;
    };
    const createTemplate = (values = slots(), person = admin) =>
      send(
        person,
        "templates",
        { action: "create", name: "Example template", slots: values },
        201,
      );
    const createType = (template_id: number, person = admin) =>
      send(
        person,
        "day-types",
        { action: "create", name: "Example type", template_id },
        201,
      );
    const empty = {
      status: "no_day_type",
      day: "2026-01-01",
      day_type: null,
      template: null,
      slots: [],
    };
    assert.deepEqual(await send(admin, "today"), empty);
    const first = await createTemplate();
    assert.deepEqual(
      first.slots.map((slot: { share_bp: number }) => slot.share_bp),
      [2000, 3000, 1000, 4000],
    );
    assert.equal(first.slots[0].fill_hint, slots()[0]?.fill_hint);
    const firstType = (await createType(first.template.id)).day_type;
    await send(admin, "default-day-type", { day_type_id: firstType.id });
    assert.deepEqual(await send(admin, "today"), {
      status: "ready",
      day: empty.day,
      day_type: firstType,
      ...first,
    });
    const second = await createTemplate(slots([33.33, 33.33, 33.34]));
    assert.deepEqual(
      second.slots.map((slot: { share_bp: number }) => slot.share_bp),
      [3333, 3333, 3334],
    );
    const secondType = (await createType(second.template.id)).day_type;
    await send(admin, "default-day-type", { day_type_id: secondType.id });
    assert.equal((await send(admin, "today")).template.id, second.template.id);
    await send(admin, "default-day-type", { day_type_id: firstType.id });
    assert.equal(
      (await send(admin, "day-type", { day_type_id: secondType.id })).day,
      empty.day,
    );
    const selected = {
      status: "ready",
      day: empty.day,
      day_type: secondType,
      ...second,
    };
    assert.deepEqual(await send(admin, "today"), selected);
    await send(admin, "day-type", {
      day_type_id: firstType.id,
      day: "2026-01-02",
    });
    assert.deepEqual(await send(admin, "today"), selected);
    assert.equal(
      selectedTemplate(database, admin.user, "2026-01-02").template?.id,
      first.template.id,
    );
    assert.equal(
      selectedTemplate(database, admin.user, "2026-01-03").template?.id,
      first.template.id,
    );
    await send(admin, "day-types", {
      action: "update",
      id: secondType.id,
      name: "Example changed",
      template_id: first.template.id,
    });
    assert.equal((await send(admin, "today")).template.id, first.template.id);
    await send(admin, "day-types", {
      action: "update",
      id: secondType.id,
      name: "Example restored",
      template_id: second.template.id,
    });
    const before = await send(admin, "today");
    database.exec(
      "CREATE TEMP TRIGGER reject_example_slot BEFORE INSERT ON template_slots WHEN NEW.name = 'Reject slot' BEGIN SELECT RAISE(ABORT, 'rejected slot'); END",
    );
    const logged = context.mock.method(console, "error", () => {});
    await send(
      admin,
      "templates",
      {
        action: "update",
        id: second.template.id,
        name: "Rejected update",
        slots: [{ ...slots([100])[0], name: "Reject slot" }],
      },
      500,
      "internal",
    );
    logged.mock.restore();
    assert.deepEqual(await send(admin, "today"), before);
    const edited = await send(admin, "templates", {
      action: "update",
      id: second.template.id,
      name: "Example edited",
      slots: [{ ...slots([100])[0], fill_hint: null }],
    });
    assert.equal(edited.slots.length, 1);
    assert.equal(edited.slots[0].fill_hint, null);
    assert.equal(edited.template.created_at, second.template.created_at);
    assert.deepEqual((await send(admin, "today")).slots, edited.slots);
    await send(
      admin,
      "templates",
      { action: "delete", id: second.template.id },
      409,
      "template_in_use",
    );
    assert.deepEqual((await send(admin, "today")).slots, edited.slots);
    for (const day_type_id of [firstType.id, secondType.id])
      await send(
        admin,
        "day-types",
        { action: "delete", id: day_type_id },
        409,
        "day_type_in_use",
      );
    for (const [path, body] of [
      [
        "templates",
        {
          action: "update",
          id: first.template.id,
          name: "Other",
          slots: slots(),
        },
      ],
      ["templates", { action: "delete", id: first.template.id }],
      [
        "day-types",
        { action: "create", name: "Other", template_id: first.template.id },
      ],
      [
        "day-types",
        {
          action: "update",
          id: firstType.id,
          name: "Other",
          template_id: first.template.id,
        },
      ],
      ["day-types", { action: "delete", id: firstType.id }],
      ["default-day-type", { day_type_id: firstType.id }],
      ["day-type", { day_type_id: firstType.id }],
      ["day-type", { day_type_id: 999999 }],
    ] as const)
      await send(member, path, body, 404, "not_found");
    assert.deepEqual(await send(member, "today"), empty);
    for (const [sql, parameters] of [
      [
        "INSERT INTO template_slots (user_id, template_id, position, name, start_minute, end_minute, share_bp) VALUES (?, ?, 0, 'Example', 0, 60, 10000)",
        [member.user.id, first.template.id],
      ],
      [
        "INSERT INTO day_types (user_id, name, template_id) VALUES (?, 'Example', ?)",
        [member.user.id, first.template.id],
      ],
      [
        "INSERT INTO default_day_types (user_id, day_type_id) VALUES (?, ?)",
        [member.user.id, firstType.id],
      ],
      [
        "INSERT INTO day_type_choices (user_id, day, day_type_id) VALUES (?, '2026-01-01', ?)",
        [member.user.id, firstType.id],
      ],
    ] as const)
      assert.throws(() => database.prepare(sql).run(...parameters), {
        code: "SQLITE_CONSTRAINT_FOREIGNKEY",
      });
    const other = await createTemplate(slots([100]), member);
    const otherType = (await createType(other.template.id, member)).day_type;
    await send(
      member,
      "day-types",
      {
        action: "update",
        id: otherType.id,
        name: "Other type",
        template_id: first.template.id,
      },
      404,
      "not_found",
    );
    await send(member, "default-day-type", { day_type_id: otherType.id });
    assert.deepEqual((await send(member, "today")).slots, other.slots);
    assert.deepEqual((await send(admin, "today")).slots, edited.slots);
    await send(admin, "day-type", { day_type_id: firstType.id });
    assert.equal((await send(admin, "today")).template.id, first.template.id);
    await send(admin, "day-types", { action: "delete", id: secondType.id });
    await send(admin, "templates", {
      action: "delete",
      id: second.template.id,
    });
    await send(
      admin,
      "templates",
      { action: "delete", id: second.template.id },
      404,
      "not_found",
    );
    assert.deepEqual(database.pragma("foreign_key_check"), []);
  });
}
