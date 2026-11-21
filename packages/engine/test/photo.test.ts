import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import {
  createVisionEstimator,
  type VisionEstimator,
} from "../src/photo/vision.ts";
import { cookie, fixture, rejection, requestedWith } from "./auth-support.ts";
import { test } from "./support/hang-ceiling.ts";

const path = "/api/photo/estimate";
const config = loadConfig({
  DATABASE_URL: ":memory:",
  TARE_VISION_PROVIDER: "google",
  TARE_VISION_MODEL: "fixture-model",
  TARE_VISION_API_KEY: "fixture-key",
});
const png = Buffer.from("89504e470d0a1a0a", "hex");
const part = {
  name: "Rice",
  search_query: "cooked rice",
  grams: 150,
  grams_low: 100,
  grams_high: 200,
};

test("photo route rejects an oversized upload", async (context) => {
  const vision = context.mock.fn<VisionEstimator>(async () => ({
    status: "vision_failed",
  }));
  const options = { config, vision };
  const { app, signIn } = fixture(context, options);
  await rejection(
    await app.request(path, {
      method: "POST",
      headers: {
        ...requestedWith,
        Cookie: cookie(await signIn()),
        "Content-Type": "image/png",
      },
      body: Buffer.alloc(5 * 1024 * 1024 + 1),
    }),
    413,
    "body_too_large",
  );
  assert.equal(vision.mock.callCount(), 0);
});

test("photo requests check auth, availability and the image before dispatch", async (context) => {
  const vision = context.mock.fn<VisionEstimator>(async () => ({
    status: "vision_failed",
  }));
  const enabled = { config, vision };
  const disabled = { config: { ...config, vision: null }, vision };
  const { app, signIn } = fixture(context, enabled);
  const unset = fixture(context, disabled);
  const session = { Cookie: cookie(await signIn()) };
  const post = (headers: HeadersInit, body?: Buffer) =>
    app.request(path, { method: "POST", headers, body });
  await rejection(await post({}), 401, "unauthenticated");
  await rejection(await post(session), 403, "requested_with_required");
  await rejection(
    await unset.app.request(path, {
      method: "POST",
      headers: { Cookie: cookie(await unset.signIn()), ...requestedWith },
    }),
    503,
    "vision_unavailable",
  );
  for (const [type, body] of [
    ["", undefined],
    ["image/png; charset=utf-8", png],
    ["image/jpeg", png],
    ["image/webp", Buffer.from("RIFF0000nope")],
  ] as const) {
    await rejection(
      await post({ ...session, ...requestedWith, "Content-Type": type }, body),
      415,
      "unsupported_media_type",
    );
  }
  assert.equal(vision.mock.callCount(), 0);
});

test("photo route returns only validated parts, never writes and hides provider errors", async (context) => {
  const marker = "private-provider-error-marker";
  const rawPart = {
    ...part,
    name: " Rice ",
    search_query: " cooked rice ",
    extra: "discard",
  };
  const results = [
    { parts: [rawPart] },
    { parts: [] },
    { parts: [{ ...part, grams_low: 160 }] },
  ];
  const vision: VisionEstimator = async () => {
    const estimate = results.shift();
    if (estimate) return { status: "ok", estimate };
    throw Object.assign(new Error(marker), { name: marker });
  };
  const options = { config, vision };
  const { app, database, signIn } = fixture(context, options);
  const headers = {
    ...requestedWith,
    Cookie: cookie(await signIn()),
    "Content-Type": "Image/PNG",
  };
  const post = () => app.request(path, { method: "POST", headers, body: png });
  const changes = database.prepare("SELECT total_changes()").pluck();
  const before = changes.get();
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { parts: [part] });
  await rejection(await post(), 422, "vision_no_food");
  await rejection(await post(), 503, "vision_invalid_response");

  const output: unknown[] = [];
  for (const method of ["error", "info", "log", "warn", "debug"] as const)
    context.mock.method(console, method, (...args: unknown[]) =>
      output.push(args.join(" ")),
    );
  for (const stream of [process.stdout, process.stderr])
    context.mock.method(
      stream,
      "write",
      (value: unknown) => output.push(String(value)) > 0,
    );
  try {
    await rejection(await post(), 503, "vision_failed");
  } finally {
    context.mock.restoreAll();
  }
  assert.deepEqual(output, []);
  assert.equal(changes.get(), before);
});

test("native adapters send one streamed image and require a completed response", async () => {
  const text = JSON.stringify({ parts: [part] });
  const content = [{ type: "text", text }];
  const candidates = [{ finishReason: "STOP", content: { parts: [{ text }] } }];
  for (const [provider, valid, invalid] of [
    [
      "anthropic",
      { stop_reason: "end_turn", content },
      ["refusal", "max_tokens"].map((stop_reason) => ({
        stop_reason,
        content,
      })),
    ],
    [
      "google",
      { candidates },
      [
        { candidates: [{ ...candidates[0], finishReason: "MAX_TOKENS" }] },
        { candidates, promptFeedback: { blockReason: "SAFETY" } },
      ],
    ],
  ] as const) {
    for (const [response, expected] of [
      [valid, "ok"],
      ...invalid.map((value) => [value, "vision_invalid_response"] as const),
      [{}, "vision_invalid_response"],
    ] as const) {
      let sends = 0;
      assert.ok(config.vision);
      const estimate = createVisionEstimator(
        { ...config.vision, provider },
        async (url, init) => {
          sends++;
          assert.equal(init?.redirect, "manual");
          assert.ok(init?.body instanceof ReadableStream);
          const headers = new Headers(init.headers);
          const json = await new Response(init.body).json();
          const image =
            provider === "anthropic"
              ? json.messages[0].content[0].source
              : json.contents[0].parts[0].inlineData;
          assert.equal(image.data, png.toString("base64"));
          assert.equal(image.media_type ?? image.mimeType, "image/png");
          assert.equal(new URL(String(url)).search, "");
          assert.equal(
            headers.get(
              provider === "anthropic" ? "x-api-key" : "x-goog-api-key",
            ),
            "fixture-key",
          );
          return Response.json(response);
        },
      );
      const result = await estimate(
        png,
        "image/png",
        new AbortController().signal,
      );
      assert.equal(sends, 1);
      assert.deepEqual(
        result,
        expected === "ok"
          ? { status: "ok", estimate: { parts: [part] } }
          : { status: expected },
      );
    }
  }
});
