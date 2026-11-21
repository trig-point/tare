import { z } from "zod";
import { ApiError, api } from "./api.ts";

export const photoPath = "/api/photo/estimate";
export const maxPhotoBytes = 5 * 1024 * 1024;
const photoTypes = ["image/jpeg", "image/png", "image/webp"];

const grams = z.number().positive();
const estimateSchema = z.object({
  parts: z
    .array(
      z.object({
        name: z.string(),
        search_query: z.string(),
        grams,
        grams_low: grams,
        grams_high: grams,
      }),
    )
    .min(1)
    .max(12),
});
export type EstimatedPart = z.infer<typeof estimateSchema>["parts"][number];

const candidatesSchema = z.object({
  candidates: z.array(
    z.object({
      fdc_id: z.number().int().positive(),
      name: z.string(),
      data_type: z.string(),
      brand: z.string().nullable(),
      kcal_per_100g: z.number().nonnegative().nullable(),
    }),
  ),
});
export type Candidate = z.infer<typeof candidatesSchema>["candidates"][number];

const sourceFoodSchema = z.object({
  source_food_id: z.number().int().positive(),
});
const mealSchema = z.object({ entries: z.array(z.unknown()).min(1) });

export type PhotoCode =
  | "vision_no_food"
  | "vision_unavailable"
  | "vision_rate_limited"
  | "vision_failed"
  | "vision_invalid_response"
  | "body_too_large"
  | "unsupported_media_type";

export const photoMessages: Record<PhotoCode, string> = {
  vision_no_food: "No food found",
  vision_unavailable: "Photo estimates are off",
  vision_rate_limited: "Try again in a minute",
  vision_failed: "Couldn’t estimate the photo",
  vision_invalid_response: "Couldn’t estimate the photo",
  body_too_large: "Photo too large",
  unsupported_media_type: "Use a JPEG, PNG or WebP photo",
};

/** The UI line for a failed estimate, whatever the error. */
export function photoMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  return code !== undefined && code in photoMessages
    ? photoMessages[code as PhotoCode]
    : "Couldn’t estimate the photo";
}

/**
 * An empty POST returns vision_unavailable when no model is set and 415 when
 * one is, without calling the model.
 */
export async function probePhoto(signal?: AbortSignal) {
  try {
    await api(photoPath, { method: "POST", signal });
  } catch (error) {
    if (error instanceof ApiError && error.code === "vision_unavailable")
      return false;
    if (error instanceof ApiError && error.status === 415) return true;
    throw error;
  }
  throw new Error("Unexpected probe answer");
}

const probeStorageKey = (person: number) => `tare:photo-available:${person}`;

/** Whether the Photo tab shows; the last answer is kept so the tab row does not jump. */
export function photoProbeQuery(person: number) {
  return {
    queryKey: ["photo_probe", person] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const available = await probePhoto(signal);
      try {
        localStorage.setItem(probeStorageKey(person), String(available));
      } catch {
        // Blocked storage loses only the remembered answer.
      }
      return available;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  };
}

export function savedPhotoProbe(person: number): boolean | undefined {
  try {
    const saved = localStorage.getItem(probeStorageKey(person));
    return saved === "true" ? true : saved === "false" ? false : undefined;
  } catch {
    return undefined;
  }
}

export async function estimatePhoto(image: Blob, signal?: AbortSignal) {
  return estimateSchema.parse(
    await api(photoPath, {
      method: "POST",
      headers: { "Content-Type": image.type },
      body: image,
      signal,
    }),
  ).parts;
}

export async function searchCandidates(query: string, signal?: AbortSignal) {
  return candidatesSchema.parse(
    await api("/api/lookup/candidates", {
      method: "POST",
      body: JSON.stringify({ query: query.trim(), limit: 5 }),
      signal,
    }),
  ).candidates;
}

export async function addSourceFood(fdcId: number) {
  return sourceFoodSchema.parse(
    await api("/api/lookup/source-food", {
      method: "POST",
      body: JSON.stringify({ fdc_id: fdcId }),
    }),
  ).source_food_id;
}

export type ReviewPart = {
  key: string;
  name: string;
  searchQuery: string;
  grams: string;
  low: number;
  high: number;
  pick: Candidate | null;
};

export function reviewParts(parts: EstimatedPart[]): ReviewPart[] {
  return parts.map((part) => ({
    key: crypto.randomUUID(),
    name: part.name,
    searchQuery: part.search_query,
    grams: String(part.grams),
    low: part.grams_low,
    high: part.grams_high,
    pick: null,
  }));
}

/** Grams as entered, or null when the field is not a positive number. */
export function partGrams(part: ReviewPart) {
  const value = Number(part.grams);
  return part.grams.trim() && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function canLog(parts: ReviewPart[]) {
  return (
    parts.length > 0 &&
    parts.every((part) => part.pick !== null && partGrams(part) !== null)
  );
}

/**
 * Adds each picked food to the source cache, then logs the meal. The estimate's
 * range is kept only while it still brackets the grams sent.
 */
export async function logMeal(clientId: string, parts: ReviewPart[]) {
  if (!canLog(parts)) throw new Error("Incomplete meal");
  const ids = await Promise.all(
    parts.map((part) => addSourceFood((part.pick as Candidate).fdc_id)),
  );
  const body = {
    client_id: clientId,
    parts: parts.map((part, index) => {
      const grams = partGrams(part) as number;
      return {
        source_food_id: ids[index],
        grams,
        ...(part.low <= grams && grams <= part.high
          ? { grams_low: part.low, grams_high: part.high }
          : {}),
      };
    }),
  };
  return mealSchema.parse(
    await api("/api/intake/meal-parts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ).entries.length;
}

/** The photo as sent: an accepted type under 5 MiB, otherwise a smaller JPEG. */
export async function photoToSend(file: Blob): Promise<Blob> {
  if (photoTypes.includes(file.type) && file.size <= maxPhotoBytes) return file;
  const bitmap = await createImageBitmap(file);
  try {
    for (const side of [2048, 1600, 1200]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const blob = await drawJpeg(
        bitmap,
        Math.round(bitmap.width * scale),
        Math.round(bitmap.height * scale),
      );
      if (blob.size <= maxPhotoBytes) return blob;
    }
  } finally {
    bitmap.close();
  }
  throw new ApiError(413, "body_too_large");
}

export function drawJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("No canvas"));
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No image"))),
      "image/jpeg",
      0.85,
    ),
  );
}
