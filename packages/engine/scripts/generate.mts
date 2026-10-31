#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";

const directory = "./src/queries";
const files = readdirSync(directory, {
  recursive: true,
  encoding: "utf8",
});
// A fresh schema prevents local artifacts from hiding query or migration changes.
rmSync("./data/typesql.sqlite", { force: true });
for (const name of files.filter((name) => name.endsWith(".sql"))) {
  rmSync(join(directory, `${name.slice(0, -4)}.ts`), { force: true });
}
openDatabase("./data/typesql.sqlite").close();
const result = spawnSync("typesql", ["compile"], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const queries = files.filter((name) => name.endsWith(".sql"));
for (const query of queries) {
  if (!readFileSync(join(directory, query), "utf8").trim()) {
    throw new Error(`Empty SQL query: ${query}`);
  }
  const generated = join(directory, `${query.slice(0, -4)}.ts`);
  const content = readFileSync(generated, "utf8");
  // TypeSQL marks invalid queries in its output even when it exits successfully.
  if (!content.trim() || content.includes("//Invalid SQL")) {
    throw new Error(`Invalid SQL generated for ${query}`);
  }
}
for (const name of readdirSync(directory, {
  recursive: true,
  encoding: "utf8",
})) {
  if (name.endsWith(".ts") && !queries.includes(`${name.slice(0, -3)}.sql`)) {
    throw new Error(`Generated file has no SQL query: ${name}`);
  }
}
