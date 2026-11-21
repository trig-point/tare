import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import {
  createVisionEstimator,
  type VisionEstimator,
} from "../src/photo/vision.ts";
import { insertAgentToken } from "../src/queries/insert-agent-token.ts";
import {
  accessConfig,
  accessFixture,
  assertionHeader,
  cookie,
  fixture,
  issuedAt,
  rejection,
  requestedWith,
  signAccessToken,
} from "./auth-support.ts";
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
  const access = accessFixture(context, undefined, {
    config: { ...accessConfig, vision: config.vision },
  });
  insertAgentToken(access.database, {
    client_id: "example-agent",
    user_id: access.admin.id,
    name: "Example agent",
    created_at: issuedAt.toISOString(),
  });
  const postAccess = (headers?: HeadersInit) =>
    access.app.request(path, { method: "POST", headers });
  await rejection(await postAccess(), 401, "unauthenticated");
  const service = await signAccessToken({
    sub: "",
    common_name: "example-agent",
  });
  await rejection(await postAccess(assertionHeader(service)), 403, "forbidden");
  await rejection(
    await postAccess({
      ...assertionHeader(await signAccessToken()),
      ...requestedWith,
    }),
    415,
    "unsupported_media_type",
  );
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
  const results: Awaited<ReturnType<VisionEstimator>>[] = [
    ...Array.from({ length: 3 }, () => ({
      status: "ok" as const,
      estimate: { parts: [rawPart] },
    })),
    { status: "ok", estimate: { parts: [] } },
    { status: "ok", estimate: { parts: [{ ...part, grams_low: 160 }] } },
    { status: "ok", estimate: { parts: [{ ...part, grams_high: 5001 }] } },
    { status: "vision_rate_limited" },
  ];
  const vision: VisionEstimator = async () => {
    const result = results.shift();
    if (result) return result;
    throw Object.assign(new Error(marker), { name: marker });
  };
  const options = { config, vision };
  const { app, database, signIn } = fixture(context, options);
  const headers = {
    ...requestedWith,
    Cookie: cookie(await signIn()),
    "Content-Type": "Image/PNG",
  };
  const post = (body = png, type = "Image/PNG") =>
    app.request(path, {
      method: "POST",
      headers: { ...headers, "Content-Type": type },
      body,
    });
  const changes = database.prepare("SELECT total_changes()").pluck();
  const before = changes.get();
  for (const [bytes, type] of [
    [png, "Image/PNG"],
    [Buffer.from("ffd8ffe0", "hex"), "image/jpeg"],
    [Buffer.from("RIFF0000WEBP"), "image/webp"],
  ] as const) {
    const response = await post(bytes, type);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { parts: [part] });
  }
  await rejection(await post(), 422, "vision_no_food");
  await rejection(await post(), 503, "vision_invalid_response");
  await rejection(await post(), 503, "vision_invalid_response");
  await rejection(await post(), 503, "vision_rate_limited");

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

test("vendor transport cancels refusals and distinguishes malformed JSON", async (context) => {
  assert.ok(config.vision);
  for (const [status, expected] of [
    [429, "vision_rate_limited"],
    [302, "vision_failed"],
    [200, "vision_invalid_response"],
  ] as const) {
    const cancel = context.mock.fn();
    const body = new ReadableStream({
      start(controller) {
        if (status === 200) {
          controller.enqueue(new TextEncoder().encode("not JSON"));
          controller.close();
        }
      },
      cancel,
    });
    const request = context.mock.fn<typeof fetch>(
      async () => new Response(body, { status }),
    );
    const estimate = createVisionEstimator(config.vision, request);
    assert.deepEqual(
      await estimate(png, "image/png", new AbortController().signal),
      { status: expected },
    );
    assert.equal(cancel.mock.callCount(), status === 200 ? 0 : 1);
    assert.deepEqual(await estimate(png, "image/png", AbortSignal.abort()), {
      status: "vision_failed",
    });
    assert.equal(request.mock.callCount(), 1);
  }
});

test("native adapters send one streamed image and require a completed response", async () => {
  const text = JSON.stringify({ parts: [part] });
  const content = [{ type: "text", text }];
  const candidates = [
    {
      finishReason: "STOP",
      content: { parts: [{ text: "thinking", thought: true }, { text }] },
    },
  ];
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
          if (provider === "anthropic")
            assert.equal(headers.get("anthropic-version"), "2026-10-21");
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
