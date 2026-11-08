import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importFiles } from "../../../packages/engine/src/import/files.ts";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import {
  dayKey,
  nextUnsignedDay,
  readDay,
  readUnsignedDays,
  signOffDay,
  signOffValues,
} from "../src/days-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { DayReview, UnsignedDays } = await import("../src/sign-off.tsx");
const signal = new AbortController().signal;
const unsigned = async () =>
  (await readUnsignedDays(signal)).map((entry) => entry.day);

async function engine(context: Parameters<typeof twoUsers>[0]) {
  const setup = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", setup.admin.request);
  const eat = async (day: string, name: string) => {
    const response = await fetch("/api/intake", {
      method: "POST",
      body: JSON.stringify({
        client_id: `example-${day}-${name}`,
        name,
        kcal: 400,
        protein_g: 20,
        eaten_at: `${day}T06:00:00.000Z`,
      }),
    });
    assert.ok(response.ok);
    return ((await response.json()) as { entry: { id: number } }).entry.id;
  };
  return { setup, person: setup.admin.user.id, eat };
}

async function review(person: number, day: string, next: string | null) {
  const client = new QueryClient();
  client.setQueryData(dayKey(person, day), await readDay(day, signal));
  const node: ReactElement = createElement(DayReview, {
    person,
    day,
    online: true,
    next,
    open: () => {},
    close: () => {},
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node),
  );
}

test("sign-off from the screen records the time and shows the complete marker", async (context) => {
  const { person, eat } = await engine(context);
  await eat("2025-12-30", "Example soup");
  const before = await review(person, "2025-12-30", null);
  assert.match(before, /Example soup/);
  assert.match(before, /Not signed off/);
  assert.match(before, /<button type="submit">Sign off<\/button>/);
  const values = signOffValues(await readDay("2025-12-30", signal));
  await signOffDay("2025-12-30", {
    ...values,
    hunger: "3",
    fullness: "4",
    notes: "Example note",
  });
  const day = await readDay("2025-12-30", signal);
  assert.equal(day.signed_off_at, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(
    [day.hunger, day.fullness, day.notes],
    [3, 4, "Example note"],
  );
  const after = await review(person, "2025-12-30", null);
  assert.match(after, /Complete <time dateTime="2026-01-01T00:00:00.000Z">/);
  assert.doesNotMatch(after, /Sign off<\/button>/);
});

test("unsigned days are listed and reviewed in turn", async (context) => {
  const { person, eat } = await engine(context);
  assert.match(
    renderToStaticMarkup(
      createElement(UnsignedDays, {
        days: await readUnsignedDays(signal),
        failed: false,
        online: true,
        open: () => {},
      }),
    ),
    /All past days signed off/,
  );
  for (const day of ["2025-12-28", "2025-12-29", "2025-12-30"])
    await eat(day, "Example rice");
  await eat("2026-01-01", "Example toast");
  const days = await readUnsignedDays(signal);
  assert.deepEqual(
    days.map((entry) => entry.day),
    ["2025-12-30", "2025-12-29", "2025-12-28"],
  );
  const list = renderToStaticMarkup(
    createElement(UnsignedDays, {
      days,
      failed: false,
      online: true,
      open: () => {},
    }),
  );
  assert.equal(list.match(/aria-label="Review 2025-12-\d\d"/g)?.length, 3);
  const next = nextUnsignedDay(days, "2025-12-30");
  assert.equal(next, "2025-12-29");
  assert.match(await review(person, "2025-12-30", next), /Next day/);
  const [first] = days;
  assert.ok(first);
  await signOffDay("2025-12-30", signOffValues(first));
  const remaining = await readUnsignedDays(signal);
  assert.deepEqual(
    remaining.map((entry) => entry.day),
    ["2025-12-29", "2025-12-28"],
  );
  assert.equal(nextUnsignedDay(remaining, "2025-12-28"), "2025-12-29");
  assert.doesNotMatch(await review(person, "2025-12-28", null), /Next day/);
});

test("imported days are listed until signed off", async (context) => {
  const { setup } = await engine(context);
  const folder = await mkdtemp(join(tmpdir(), "tare-sign-off-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, "days.jsonl");
  await writeFile(
    file,
    `${JSON.stringify({ day: "2025-12-20", hunger: 2 })}\n`,
  );
  await importFiles(setup.database, setup.admin.user.username, { days: file });
  assert.deepEqual(await unsigned(), ["2025-12-20"]);
  await signOffDay("2025-12-20", { hunger: "2", fullness: "", notes: "" });
  assert.deepEqual(await unsigned(), []);
});

test("an intake change clears the sign-off and returns the day to the list", async (context) => {
  const { person, eat } = await engine(context);
  const id = await eat("2025-12-30", "Example stew");
  await signOffDay("2025-12-30", { hunger: "", fullness: "", notes: "" });
  assert.deepEqual(await unsigned(), []);
  const response = await fetch(`/api/intake/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ kcal: 450 }),
  });
  assert.ok(response.ok);
  assert.deepEqual(await unsigned(), ["2025-12-30"]);
  assert.equal((await readDay("2025-12-30", signal)).signed_off_at, null);
  assert.match(await review(person, "2025-12-30", null), /Not signed off/);
});
