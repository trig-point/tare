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

function join(path: string, segment: string) {
  if (segment === "[]") return `${path}[]`;
  return path ? `${path}.${segment}` : segment;
}

export function readPropertyPaths(...schemas: z.ZodType[]): Set<string> {
  const paths = new Set<string>();
  function walk(schema: z.ZodType, path: string) {
    if (schema instanceof z.ZodObject) {
      for (const [name, child] of Object.entries(schema.shape)) {
        paths.add(join(path, name));
        walk(child as z.ZodType, join(path, name));
      }
    } else if (schema instanceof z.ZodUnion) {
      for (const option of schema.options) walk(option as z.ZodType, path);
    } else if (schema instanceof z.ZodArray) {
      paths.add(join(path, "[]"));
      walk(schema.element as z.ZodType, join(path, "[]"));
    } else if (
      schema instanceof z.ZodOptional ||
      schema instanceof z.ZodNullable ||
      schema instanceof z.ZodCatch
    ) {
      walk(schema.unwrap() as z.ZodType, path);
    }
  }
  for (const schema of schemas) walk(schema, "");
  return paths;
}

type ReadEndpoint = { match: RegExp; paths: Set<string> };
const productPaths = readPropertyPaths(productResponseSchema);
// The adapter parses each search.pl product with the lookup's product schema.
export const offReadEndpoints: ReadEndpoint[] = [
  { match: /^\/api\/v2\/product\//, paths: productPaths },
  {
    match: /^\/cgi\/search[.]pl$/,
    paths: new Set(
      [...productPaths]
        .filter((path) => path === "product" || path.startsWith("product."))
        .map((path) => `products[]${path.slice("product".length)}`)
        .concat("products"),
    ),
  },
];

const diffObject = z.record(z.string(), z.unknown());
const optionalObject = diffObject.default({});
const nameList = z.array(z.string()).default([]);
const entryList = z.array(z.unknown()).default([]);
// Documentation-only keys; patternProperties stays because OFF documents nutrients through it.
const annotationKeys = new Set([
  "description",
  "title",
  "example",
  "examples",
  "externalDocs",
  "extensions",
]);

export function filterReadChanges(
  diff: unknown,
  endpoints: ReadEndpoint[],
): string[] {
  const changes = new Set<string>();
  function walkSchema(
    value: unknown,
    path: string,
    endpoint: string,
    read: Set<string>,
  ) {
    const label = `${endpoint} ${path || "response"}`;
    const holdsRead = (candidate: string) =>
      candidate === "" ||
      [...read].some(
        (readPath) =>
          readPath === candidate ||
          readPath.startsWith(`${candidate}.`) ||
          readPath.startsWith(`${candidate}[]`),
      );
    for (const [key, change] of Object.entries(diffObject.parse(value))) {
      if (key === "properties" || key === "required") {
        const fields = diffObject.parse(change);
        for (const operation of ["added", "deleted"])
          for (const name of nameList.parse(fields[operation]))
            if (read.has(join(path, name)))
              changes.add(
                `${endpoint} ${join(path, name)}: ${key} ${operation}`,
              );
        if (key === "properties")
          for (const [name, child] of Object.entries(
            optionalObject.parse(fields.modified),
          ))
            walkSchema(child, join(path, name), endpoint, read);
      } else if (key === "items") {
        walkSchema(change, join(path, "[]"), endpoint, read);
      } else if (key === "allOf" || key === "anyOf" || key === "oneOf") {
        const subschemas = diffObject.parse(change);
        for (const operation of ["added", "deleted"])
          if (
            entryList.parse(subschemas[operation]).length > 0 &&
            holdsRead(path)
          )
            changes.add(`${label}: ${key} subschema ${operation}`);
        for (const entry of entryList.parse(subschemas.modified))
          walkSchema(diffObject.parse(entry).diff, path, endpoint, read);
      } else if (holdsRead(path) && !annotationKeys.has(key)) {
        changes.add(`${label}: ${key} changed`);
      }
    }
  }
  const readFor = (endpoint: string) =>
    endpoints.find(({ match }) => match.test(endpoint))?.paths;
  const paths = optionalObject.parse(diffObject.parse(diff).paths);
  for (const endpoint of nameList.parse(paths.deleted))
    if (readFor(endpoint)) changes.add(`${endpoint}: endpoint deleted`);
  for (const [endpoint, change] of Object.entries(
    optionalObject.parse(paths.modified),
  )) {
    const read = readFor(endpoint);
    if (!read) continue;
    const operations = optionalObject.parse(
      diffObject.parse(change).operations,
    );
    if (nameList.parse(operations.deleted).includes("GET"))
      changes.add(`${endpoint}: GET deleted`);
    const get = optionalObject.parse(
      optionalObject.parse(operations.modified).GET,
    );
    const responses = optionalObject.parse(get.responses);
    if (nameList.parse(responses.deleted).includes("200"))
      changes.add(`${endpoint}: 200 response deleted`);
    const success = optionalObject.parse(
      optionalObject.parse(responses.modified)["200"],
    );
    const content = optionalObject.parse(success.content);
    if (nameList.parse(content.deleted).includes("application/json"))
      changes.add(`${endpoint}: JSON response deleted`);
    const json = optionalObject.parse(
      optionalObject.parse(content.modified)["application/json"],
    );
    if (json.schema !== undefined) walkSchema(json.schema, "", endpoint, read);
  }
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
      } else fields.add([prefix, ...issue.path].filter(Boolean).join("."));
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
        offReadEndpoints,
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
      if (detail.fdcId !== identifier)
        return ["food.fdcId: does not match the search result"];
      // Unreadable nutrient entries parse as null, so a reshaped list would otherwise pass.
      return detail.foodNutrients.some((nutrient) => nutrient !== null)
        ? []
        : ["food.foodNutrients: expected at least one readable nutrient"];
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
