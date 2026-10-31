#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";

openDatabase("./data/typesql.sqlite").close();
const result = spawnSync("typesql", ["compile"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const directory = "./src/queries";
const queries = readdirSync(directory, {
  recursive: true,
  encoding: "utf8",
}).filter((name) => name.endsWith(".sql"));
if (queries.length === 0) throw new Error("No SQL queries found");
for (const query of queries) {
  const generated = join(directory, `${query.slice(0, -4)}.ts`);
  const content = readFileSync(generated, "utf8");
  // TypeSQL marks invalid queries in its output even when it exits successfully.
  if (!content.trim() || content.includes("//Invalid SQL")) {
    throw new Error(`Invalid SQL generated for ${query}`);
  }
}
