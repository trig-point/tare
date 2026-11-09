import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import { bodyFatKey, readBodyFat } from "../src/body-fat-api.ts";
import { readToday } from "../src/today-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { BodyFatCard } = await import("../src/body-fat.tsx");
const signal = new AbortController().signal;

test("the client schemas keep body fat and the card marks a post-workout reading", async (context) => {
  const { admin } = await twoUsers(context, "fallback");
  context.mock.method(globalThis, "fetch", admin.request);
  const post = async (path: string, body: object) =>
    assert.ok(
      (await fetch(path, { method: "POST", body: JSON.stringify(body) })).ok,
    );
  await post("/api/activities", {
    started_at: "2025-12-31T20:00:00.000Z",
    duration_minutes: 60,
    kind: "strength",
  });
  await post("/api/weights", {
    client_id: "example-weight",
    weight_kg: 70,
    body_fat_pct: 21.5,
  });
  assert.equal((await readToday(signal)).weights[0]?.body_fat_pct, 21.5);
  const bodyFat = await readBodyFat(signal);
  assert.deepEqual(
    bodyFat.readings.map((reading) => [
      reading.body_fat_pct,
      reading.after_workout,
    ]),
    [[21.5, true]],
  );
  const card = (data: typeof bodyFat) => {
    const client = new QueryClient();
    client.setQueryData(bodyFatKey(admin.user.id), data);
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(BodyFatCard, { person: admin.user.id, online: true }),
      ),
    );
  };
  const html = card(bodyFat);
  assert.match(html, /21.5%.*After a workout/s);
  assert.match(
    html,
    /<p>Not enough readings for a trend<\/p><p>0 of 8 readings/,
  );
  const lines = [
    "No strength sessions logged in 3 weeks.",
    "Weight down 1.2 kg.",
  ];
  const change =
    "Body fat reading up 1.2 points, within this scale&#x27;s error.";
  const ready = card({
    ...bodyFat,
    trend: {
      status: "ready",
      level_pct: 23.3,
      lines: [...lines, change.replace("&#x27;", "'")],
    },
  });
  assert.match(
    ready,
    new RegExp(
      `<p><strong>23.3%</strong></p><p>${lines.join("</p><p>")}</p><p title="This scale&#x27;s error is about 2 points">${change}</p>`,
    ),
  );
  assert.equal(ready.split("Body fat reading").length, 2);
});
