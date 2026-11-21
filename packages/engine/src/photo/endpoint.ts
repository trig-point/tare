import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  type AuthEnv,
  authenticatedPerson,
  requireRequestedWith,
  sessionAuth,
} from "../auth/middleware.ts";
import type { AppOptions } from "../auth/routes.ts";
import {
  createVisionEstimator,
  type ImageType,
  type VisionEstimator,
} from "./vision.ts";

export const photoEstimatePath = "/api/photo/estimate";
export interface PhotoOptions {
  vision?: VisionEstimator;
}

const maxBytes = 5 * 1024 * 1024;
const maxParts = 12;
const signatures: Record<ImageType, Buffer> = {
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": Buffer.from("RIFF"),
};
const webpSignature = Buffer.from("WEBP");
const estimateSchema = z.object({
  parts: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(120),
          search_query: z.string().trim().min(1).max(200),
          grams: z.number().positive().max(5000),
          grams_low: z.number().positive(),
          grams_high: z.number().positive(),
        })
        .refine(
          (part) =>
            part.grams_low <= part.grams && part.grams <= part.grams_high,
        ),
    )
    .max(maxParts),
});

export function mountPhotoEstimate(
  app: Hono<AuthEnv>,
  deps: Pick<AppOptions, "config" | "database" | "clock"> & PhotoOptions,
) {
  const estimate =
    deps.config.vision &&
    (deps.vision ?? createVisionEstimator(deps.config.vision));
  const limit = bodyLimit({
    maxSize: maxBytes,
    onError: (context) =>
      context.json({ error: { code: "body_too_large" } }, 413),
  });

  app.post(
    photoEstimatePath,
    deps.config.identity.mode === "access"
      ? authenticatedPerson
      : sessionAuth(deps.database, deps.clock),
    async (context, next) => {
      const credential = context.get("credential");
      if (credential !== "session" && credential !== "access")
        return context.json({ error: { code: "forbidden" } }, 403);
      await next();
    },
    requireRequestedWith,
    async (context) => {
      if (!estimate)
        return context.json({ error: { code: "vision_unavailable" } }, 503);
      const mediaType = context.req
        .header("Content-Type")
        ?.trim()
        .toLowerCase();
      if (
        mediaType !== "image/jpeg" &&
        mediaType !== "image/png" &&
        mediaType !== "image/webp"
      )
        return context.json({ error: { code: "unsupported_media_type" } }, 415);

      try {
        const limited = await limit(context, async () => {
          const image = Buffer.from(await context.req.arrayBuffer());
          const signature = signatures[mediaType];
          if (
            !image.subarray(0, signature.length).equals(signature) ||
            (mediaType === "image/webp" &&
              !image.subarray(8, 12).equals(webpSignature))
          ) {
            context.res = context.json(
              { error: { code: "unsupported_media_type" } },
              415,
            );
            return;
          }
          const result = await estimate(
            image,
            mediaType,
            context.req.raw.signal,
          );
          if (result.status !== "ok") {
            context.res = context.json({ error: { code: result.status } }, 503);
            return;
          }
          const parsed = estimateSchema.safeParse(result.estimate);
          if (!parsed.success) {
            context.res = context.json(
              { error: { code: "vision_invalid_response" } },
              503,
            );
            return;
          }
          context.res = parsed.data.parts.length
            ? context.json(parsed.data, 200)
            : context.json({ error: { code: "vision_no_food" } }, 422);
        });
        return limited ?? context.res;
      } catch {
        return context.json({ error: { code: "vision_failed" } }, 503);
      }
    },
  );
}
