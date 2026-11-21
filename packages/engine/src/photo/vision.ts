import { z } from "zod";
import type { VisionConfig } from "../config.ts";

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
type VisionResult =
  | { status: "ok"; estimate: unknown }
  | {
      status:
        | "vision_failed"
        | "vision_rate_limited"
        | "vision_invalid_response";
    };

export type VisionEstimator = (
  image: Buffer,
  mediaType: ImageType,
  signal: AbortSignal,
) => Promise<VisionResult>;

const prompt = [
  "Name the visible foods in this meal photo, with one part per food and at most 12 parts.",
  "Use short names (up to 120 characters) and nonblank USDA search queries (up to 200 characters).",
  "For each part guess grams and give a plausible range with 0 < grams_low <= grams <= grams_high <= 5000.",
  "Return an empty parts array if no food is visible.",
].join(" ");

const partProperties = {
  name: { type: "string" },
  search_query: { type: "string" },
  grams: { type: "number" },
  grams_low: { type: "number" },
  grams_high: { type: "number" },
};
const format = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: partProperties,
        required: Object.keys(partProperties),
        additionalProperties: false,
      },
    },
  },
  required: ["parts"],
  additionalProperties: false,
};

const anthropicEnvelope = z.object({
  stop_reason: z.literal("end_turn"),
  content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
});

const geminiEnvelope = z.object({
  promptFeedback: z.object({ blockReason: z.never().optional() }).optional(),
  candidates: z.tuple([
    z.object({
      finishReason: z.literal("STOP"),
      content: z.object({
        parts: z.array(
          z.object({ text: z.string(), thought: z.boolean().optional() }),
        ),
      }),
    }),
  ]),
});

function anthropic(config: VisionConfig, mediaType: ImageType, data: string) {
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: { "x-api-key": config.apiKey, "anthropic-version": "2026-10-21" },
    body: {
      model: config.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      output_config: { format: { type: "json_schema", schema: format } },
    },
    readText(envelope: unknown) {
      const result = anthropicEnvelope.safeParse(envelope);
      return result.success ? result.data.content[0].text : undefined;
    },
  };
}

function gemini(config: VisionConfig, mediaType: ImageType, data: string) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
    headers: { "x-goog-api-key": config.apiKey },
    body: {
      contents: [
        {
          parts: [
            { inlineData: { mimeType: mediaType, data } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: format,
      },
    },
    readText(envelope: unknown) {
      const result = geminiEnvelope.safeParse(envelope);
      return result.success
        ? result.data.candidates[0].content.parts
            .filter((part) => !part.thought)
            .map((part) => part.text)
            .join("")
        : undefined;
    },
  };
}

export function createVisionEstimator(
  config: VisionConfig,
  request = fetch,
): VisionEstimator {
  const adapter = config.provider === "anthropic" ? anthropic : gemini;
  return async (image, mediaType, requestSignal) => {
    const signal = AbortSignal.any([
      requestSignal,
      AbortSignal.timeout(30_000),
    ]);
    try {
      signal.throwIfAborted();
      const { url, headers, body, readText } = adapter(
        config,
        mediaType,
        image.toString("base64"),
      );
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        redirect: "manual",
        signal,
        duplex: "half",
        // Node fetch can replay a non-streamed request after HTTP 421.
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
            controller.close();
          },
        }),
      };
      const response = await request(url, init);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return {
          status:
            response.status === 429 ? "vision_rate_limited" : "vision_failed",
        };
      }
      try {
        const envelope: unknown = await response.json();
        signal.throwIfAborted();
        const text = readText(envelope);
        if (text === undefined) return { status: "vision_invalid_response" };
        const estimate: unknown = JSON.parse(text);
        return { status: "ok", estimate };
      } catch (error) {
        if (!signal.aborted && error instanceof SyntaxError)
          return { status: "vision_invalid_response" };
        return { status: "vision_failed" };
      }
    } catch {
      return { status: "vision_failed" };
    }
  };
}
