#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { productResponseSchema } from "../src/sources/off.ts";
import { usdaFoodSchema, usdaSearchSchema } from "../src/sources/usda.ts";

const offSpec = (revision: string) =>
  `https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/${revision}/docs/api/ref/api.yaml`;
const usdaSpec = "https://fdc.nal.usda.gov/api-spec/fdc_api.yaml";
const baselineSchema = z.object({
  offCommit: z.string().regex(/^[a-f0-9]{40}$/),
  usdaSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
type Result = { status: "pass" | "drift" | "unavailable"; details: string[] };
type VendorResults = { live: Result; docs: Result };
type Options = {
  baseline: z.infer<typeof baselineSchema>;
  fetch?: typeof fetch;
  apiKey?: string;
  runOasdiff?: (base: string, revision: string) => Promise<unknown>;
};

export function readPropertyNames(...schemas: z.ZodType[]): Set<string> {
  const names = new Set<string>();
  function walk(schema: z.ZodType) {
    if (schema instanceof z.ZodObject) {
      for (const [name, child] of Object.entries(schema.shape)) {
        names.add(name);
        walk(child as z.ZodType);
      }
    } else if (schema instanceof z.ZodUnion) {
      for (const option of schema.options) walk(option as z.ZodType);
    } else if (schema instanceof z.ZodArray) {
      walk(schema.element as z.ZodType);
    } else if (
      schema instanceof z.ZodOptional ||
      schema instanceof z.ZodNullable ||
      schema instanceof z.ZodCatch
    ) {
      walk(schema.unwrap() as z.ZodType);
    }
  }
  for (const schema of schemas) walk(schema);
  return names;
}

export function filterReadChanges(diff: unknown, names: Set<string>): string[] {
  const changes = new Set<string>();
  function walk(value: unknown, path: string[], read = false) {
    if (value === null || typeof value !== "object") {
      if (read) changes.add(path.join("."));
      return;
    }
    if (Array.isArray(value)) {
      if (read && value.length > 0) changes.add(path.join("."));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "properties" || key === "required") {
        if (child === null || typeof child !== "object")
          throw new Error("Invalid property diff");
        for (const [operation, fields] of Object.entries(child)) {
          if (Array.isArray(fields)) {
            for (const field of fields)
              if (typeof field === "string" && names.has(field))
                changes.add([...path, key, operation, field].join("."));
          } else if (fields !== null && typeof fields === "object") {
            for (const [field, change] of Object.entries(fields)) {
              const fieldPath = [...path, key, operation, field];
              if (operation !== "modified" && names.has(field))
                changes.add(fieldPath.join("."));
              else walk(change, fieldPath, names.has(field));
            }
          } else throw new Error("Invalid property diff");
        }
      } else walk(child, [...path, key], read);
    }
  }
  walk(z.record(z.string(), z.unknown()).parse(diff), []);
  return [...changes].sort();
}

class CheckFailure extends Error {
  status: "drift" | "unavailable";
  constructor(status: "drift" | "unavailable", message: string) {
    super(message);
    this.status = status;
  }
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  prefix: string,
): z.output<Schema> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const fields = new Set<string>();
  function collect(issues: z.core.$ZodIssue[]) {
    for (const issue of issues) {
      if (issue.code === "invalid_union") {
        for (const branch of issue.errors) collect(branch);
      } else fields.add([prefix, ...issue.path].join("."));
    }
  }
  collect(parsed.error.issues);
  throw new CheckFailure(
    "drift",
    `Invalid response: ${[...fields].join(", ")}`,
  );
}

async function check(run: () => Promise<string[]>): Promise<Result> {
  try {
    const details = await run();
    return { status: details.length > 0 ? "drift" : "pass", details };
  } catch (error) {
    return error instanceof CheckFailure
      ? { status: error.status, details: [error.message] }
      : { status: "unavailable", details: ["Check unavailable"] };
  }
}

export async function runChecks(options: Options): Promise<{
  off: VendorResults;
  usda: VendorResults;
}> {
  const request = options.fetch ?? fetch;
  async function response(url: string, headers?: Record<string, string>) {
    let received: Response;
    try {
      received = await request(url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CheckFailure("unavailable", "Network check unavailable");
    }
    if (!received.ok) {
      await received.body?.cancel();
      throw new CheckFailure(
        "unavailable",
        `HTTP ${received.status}: check unavailable`,
      );
    }
    return received;
  }
  async function json(url: string, headers?: Record<string, string>) {
    const received = await response(url, headers);
    try {
      return await received.json();
    } catch (error) {
      throw new CheckFailure(
        error instanceof SyntaxError ? "drift" : "unavailable",
        error instanceof SyntaxError
          ? "Invalid response: JSON"
          : "Response read unavailable",
      );
    }
  }
  const [offLive, offDocs, usdaLive, usdaDocs] = await Promise.all([
    check(async () => {
      const product = parse(
        productResponseSchema,
        await json(
          "https://world.openfoodfacts.org/api/v2/product/3017624010701.json",
          {
            "User-Agent":
              "Tare-Api-Drift/1.0 (https://github.com/trig-point/tare)",
          },
        ),
        "",
      );
      if (product.status !== 1)
        return ["status: expected 1 for the known product"];
      if (typeof product.product.nutriments?.["energy-kcal_100g"] !== "number")
        return ["product.nutriments.energy-kcal_100g: expected a number"];
      return [];
    }),
    check(async () => {
      const run =
        options.runOasdiff ??
        (async (base, revision) => {
          const { stdout } = await promisify(execFile)(
            "docker",
            [
              "run",
              "--rm",
              "tufin/oasdiff:v1.35.0",
              "diff",
              base,
              revision,
              "--match-path",
              "^(/api/v2/product/|/cgi/search[.]pl$)",
              "--format",
              "json",
            ],
            { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
          );
          return JSON.parse(stdout) as unknown;
        });
      return filterReadChanges(
        await run(offSpec(options.baseline.offCommit), offSpec("main")),
        readPropertyNames(productResponseSchema),
      );
    }),
    check(async () => {
      const headers = { "X-Api-Key": options.apiKey?.trim() || "DEMO_KEY" };
      const search = parse(
        usdaSearchSchema,
        await json(
          "https://api.nal.usda.gov/fdc/v1/foods/search?query=cheddar+cheese&dataType=Foundation%2CSR+Legacy%2CBranded&pageSize=3",
          headers,
        ),
        "search",
      );
      if (search.foods.length === 0)
        return ["search.foods: expected at least one food"];
      const foods = search.foods.map((food, index) =>
        parse(usdaFoodSchema, food, `search.foods.${index}`),
      );
      const identifier = foods[0]?.fdcId;
      const detail = parse(
        usdaFoodSchema,
        await json(
          `https://api.nal.usda.gov/fdc/v1/food/${identifier}`,
          headers,
        ),
        "food",
      );
      return detail.fdcId === identifier
        ? []
        : ["food.fdcId: does not match the search result"];
    }),
    check(async () => {
      const spec = await (await response(usdaSpec)).arrayBuffer();
      return createHash("sha256").update(Buffer.from(spec)).digest("hex") ===
        options.baseline.usdaSha256
        ? []
        : [`USDA spec changed: ${usdaSpec}`];
    }),
  ]);
  return {
    off: { live: offLive, docs: offDocs },
    usda: { live: usdaLive, docs: usdaDocs },
  };
}

export function report(
  results: Awaited<ReturnType<typeof runChecks>>,
  runUrl: string,
) {
  const outputs: Record<string, string> = {};
  const lines: string[] = [];
  for (const [vendor, checks] of Object.entries(results)) {
    const drift: string[] = [];
    for (const [kind, result] of Object.entries(checks)) {
      lines.push(`${vendor} ${kind}: ${result.status}`, ...result.details);
      if (result.status === "drift") drift.push(...result.details);
    }
    outputs[`${vendor}_drift`] = String(drift.length > 0);
    outputs[`${vendor}_body`] =
      drift.length > 0 ? `${drift.join("\n")}\n\nRun: ${runUrl}` : "";
  }
  return {
    outputs,
    log: lines.join("\n"),
    failed: Object.values(results).some((checks) =>
      Object.values(checks).some((result) => result.status !== "pass"),
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const baseline = baselineSchema.parse(
      JSON.parse(
        await readFile(
          new URL("api-drift-baselines.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const result = report(
      await runChecks({ baseline, apiKey: process.env.USDA_API_KEY }),
      `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    );
    console.log(result.log);
    if (process.env.GITHUB_OUTPUT) {
      const delimiter = randomUUID();
      await appendFile(
        process.env.GITHUB_OUTPUT,
        Object.entries(result.outputs)
          .map(
            ([key, value]) => `${key}<<${delimiter}\n${value}\n${delimiter}\n`,
          )
          .join(""),
      );
    }
    process.exitCode = result.failed ? 1 : 0;
  } catch {
    console.error("Check unavailable: configuration or output failure");
    process.exitCode = 1;
  }
}
