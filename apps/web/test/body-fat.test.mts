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
  for (const [path, body] of [
    [
      "activities",
      {
        started_at: "2025-12-31T20:00:00Z",
        duration_minutes: 60,
        kind: "strength",
      },
    ],
    [
      "weights",
      { client_id: "example-weight", weight_kg: 70, body_fat_pct: 21.5 },
    ],
  ] as const)
    await fetch(`/api/${path}`, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await readToday(signal)).weights[0]?.body_fat_pct, 21.5);
  const bodyFat = await readBodyFat(signal);
  const card = (data: typeof bodyFat) => {
    const client = new QueryClient();
    client.setQueryData(bodyFatKey(admin.user.id), data);
    const node = createElement(BodyFatCard, {
      person: admin.user.id,
      online: true,
    });
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, node),
    );
  };
  assert.match(
    card(bodyFat),
    /<p>Not enough readings for a trend<\/p><p>0 of 8.*21.5%.*After a workout/s,
  );
  const lines = [
    "No strength sessions logged in 3 weeks.",
    "Weight down 1.2 kg.",
  ];
  const change = "Body fat reading up 1.2 points, within this scale's error.";
  const ready = card({
    ...bodyFat,
    trend: {
      status: "ready",
      level_pct: 23.3,
      change_points: 1.2,
      lines: [...lines, change],
    },
  });
  const title = "This scale&#x27;s error is about 2 points";
  const expected = `<p><strong>23.3%</strong></p><p>${lines.join("</p><p>")}</p><p title="${title}">${change.replace("'", "&#x27;")}</p>`;
  assert.ok(ready.includes(expected));
  assert.equal(ready.split("Body fat reading").length, 2);
});
