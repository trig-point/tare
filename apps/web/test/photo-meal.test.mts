import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutboxReplay } from "../src/outbox-replay.ts";
import {
  canLog,
  estimatePhoto,
  logMeal,
  type PhotoCode,
  photoMessage,
  photoProbeQuery,
  probePhoto,
  type ReviewPart,
  reviewParts,
  searchCandidates,
} from "../src/photo-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { AddFood } = await import("../src/add-food.tsx");
const { PhotoView } = await import("../src/photo-meal.tsx");

const person = { id: 1, username: "sam" };
const estimate = {
  parts: [
    {
      name: "White rice",
      search_query: "rice white cooked",
      grams: 300,
      grams_low: 250,
      grams_high: 350,
    },
    {
      name: "Teriyaki chicken",
      search_query: "chicken thigh cooked",
      grams: 170,
      grams_low: 140,
      grams_high: 200,
    },
  ],
};
const rice = {
  fdc_id: 2512381,
  name: "Rice, white, cooked",
  data_type: "Foundation",
  brand: null,
  kcal_per_100g: 130,
};
const chicken = { ...rice, fdc_id: 2646172, name: "Chicken, thigh, cooked" };

type Call = { path: string; init: RequestInit };
function stubApi(
  context: TestContext,
  reply: (path: string, init: RequestInit) => Response,
) {
  const calls: Call[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      return reply(path, init);
    },
  );
  return calls;
}

const mealReply = (path: string, init: RequestInit) => {
  if (path === "/api/photo/estimate") return Response.json(estimate);
  if (path === "/api/lookup/candidates")
    return Response.json({ candidates: [rice, chicken] });
  if (path === "/api/lookup/source-food") {
    const { fdc_id } = JSON.parse(String(init.body));
    return Response.json({ source_food_id: fdc_id === rice.fdc_id ? 11 : 12 });
  }
  return Response.json({ entries: [{}, {}] }, { status: 201 });
};

function renderView(parts: ReviewPart[], online: boolean) {
  const client = new QueryClient();
  for (const part of parts)
    client.setQueryData(["food_candidates", part.searchQuery], [rice, chicken]);
  const noop = () => {};
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(PhotoView, {
        online,
        camera: false,
        problem: null,
        estimating: false,
        estimateError: null,
        parts,
        logging: false,
        logFailed: false,
        openCamera: noop,
        closeCamera: noop,
        capture: noop,
        pick: noop,
        change: noop,
        remove: noop,
        submit: noop,
      }),
    ),
  );
}

test("a reviewed photo meal logs its picked foods", async (context) => {
  const calls = stubApi(context, mealReply);
  const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
    type: "image/jpeg",
  });
  const parts = reviewParts(await estimatePhoto(image));
  const sent = new Headers(calls[0]?.init.headers);
  assert.equal(sent.get("Content-Type"), "image/jpeg");
  assert.equal(sent.get("X-Requested-With"), "XMLHttpRequest");
  assert.equal(calls[0]?.init.body, image);

  const [first, second] = parts;
  assert.ok(first && second);
  assert.deepEqual(await searchCandidates(first.searchQuery), [rice, chicken]);
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), {
    query: "rice white cooked",
    limit: 5,
  });
  const unpicked = renderView(parts, true);
  assert.match(unpicked, /value="White rice"/);
  assert.match(unpicked, /250 to 350 g/);
  assert.match(unpicked, /Rice, white, cooked/);
  assert.match(unpicked, /disabled=""[^>]*>Log meal/);
  assert.equal(canLog(parts), false);

  const picked = [
    { ...first, pick: rice },
    { ...second, pick: chicken },
  ];
  assert.doesNotMatch(renderView(picked, true), /disabled=""[^>]*>Log meal/);
  assert.equal(await logMeal("meal-1", picked), 2);
  const meal = calls.at(-1);
  assert.equal(meal?.path, "/api/intake/meal-parts");
  assert.deepEqual(JSON.parse(String(meal?.init.body)), {
    client_id: "meal-1",
    parts: [
      { source_food_id: 11, grams: 300, grams_low: 250, grams_high: 350 },
      { source_food_id: 12, grams: 170, grams_low: 140, grams_high: 200 },
    ],
  });
});

test("a corrected gram amount is sent, with the range only while it fits", async (context) => {
  const calls = stubApi(context, mealReply);
  const [part] = reviewParts(estimate.parts);
  assert.ok(part);
  const sentParts = async (grams: string) => {
    await logMeal("meal-2", [{ ...part, grams, pick: rice }]);
    return JSON.parse(String(calls.at(-1)?.init.body)).parts;
  };
  assert.deepEqual(await sentParts("260"), [
    { source_food_id: 11, grams: 260, grams_low: 250, grams_high: 350 },
  ]);
  assert.deepEqual(await sentParts("400"), [
    { source_food_id: 11, grams: 400 },
  ]);
  for (const grams of ["", "0", "-5", "abc"]) {
    assert.equal(canLog([{ ...part, grams, pick: rice }]), false);
    await assert.rejects(logMeal("meal-3", [{ ...part, grams, pick: rice }]));
  }
});

function renderAddFood(client: QueryClient, online = true) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(AddFood, {
        person,
        replay: {} as OutboxReplay,
        online,
      }),
    ),
  );
}
const tabs = (html: string) =>
  [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((match) => match[1]);

test("the Photo tab is hidden when photo estimates are off", async (context) => {
  for (const [status, code, available] of [
    [503, "vision_unavailable", false],
    [415, "unsupported_media_type", true],
  ] as const) {
    const calls = stubApi(context, () =>
      Response.json({ error: { code } }, { status }),
    );
    assert.equal(await probePhoto(), available);
    assert.equal(calls[0]?.init.body, undefined);
    const client = new QueryClient();
    client.setQueryData(photoProbeQuery(person.id).queryKey, available);
    assert.equal(tabs(renderAddFood(client)).includes("Photo"), available);
  }
  stubApi(context, () =>
    Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  );
  await assert.rejects(probePhoto());
});

test("offline, the Photo tab needs a connection and sends nothing", (context) => {
  const calls = stubApi(context, mealReply);
  const html = renderView(
    reviewParts(estimate.parts).map((part) => ({ ...part, pick: rice })),
    false,
  );
  assert.match(html, /Needs a connection/);
  assert.match(html, /disabled=""[^>]*>.*Take photo/);
  assert.match(html, /disabled=""[^>]*>Log meal/);
  assert.match(tabs(renderAddFood(new QueryClient(), false)).join(), /Photo/);
  assert.equal(calls.length, 0);
});

test("each estimate error has one line", async (context) => {
  const lines: Record<PhotoCode, string> = {
    vision_no_food: "No food found",
    vision_unavailable: "Photo estimates are off",
    vision_rate_limited: "Try again in a minute",
    vision_failed: "Couldn’t estimate the photo",
    vision_invalid_response: "Couldn’t estimate the photo",
    body_too_large: "Photo too large",
    unsupported_media_type: "Use a JPEG, PNG or WebP photo",
  };
  const image = new Blob(["x"], { type: "image/png" });
  for (const [code, line] of Object.entries(lines)) {
    stubApi(context, () => Response.json({ error: { code } }, { status: 503 }));
    const error = await estimatePhoto(image).catch((caught) => caught);
    assert.equal(photoMessage(error), line, code);
  }
  stubApi(context, () => Response.json({ parts: [] }));
  const empty = await estimatePhoto(image).catch((caught) => caught);
  assert.equal(photoMessage(empty), "Couldn’t estimate the photo");
});
