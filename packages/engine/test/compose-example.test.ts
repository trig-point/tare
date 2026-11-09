import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "./support/hang-ceiling.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function settingsReadBySource(): Set<string> {
  const names = new Set<string>();
  for (const group of ["packages", "apps"]) {
    for (const workspace of readdirSync(join(repoRoot, group))) {
      const sourceDir = join(repoRoot, group, workspace, "src");
      if (!existsSync(sourceDir)) continue;
      for (const file of readdirSync(sourceDir, { recursive: true })) {
        if (!/\.(ts|tsx|mts)$/.test(String(file))) continue;
        const text = readFileSync(join(sourceDir, String(file)), "utf8");
        for (const match of text.matchAll(/\bTARE_[A-Z0-9_]+\b/g)) {
          names.add(match[0]);
        }
      }
    }
  }
  return names;
}

function composeEnvironmentKeys(): Set<string> {
  const text = readFileSync(join(repoRoot, "compose.example.yaml"), "utf8");
  // No YAML parser in the repo, so the block is read by indent.
  const block = text.match(
    /^ {2}tare:\n(?: {4}.*\n)*? {4}environment:\n((?: {6}.*\n)+)/m,
  );
  assert.ok(
    block?.[1],
    "no services.tare.environment block in compose.example.yaml",
  );
  return new Set(
    [...block[1].matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map(
      (match) => match[1] ?? "",
    ),
  );
}

test("compose.example.yaml passes every TARE_ setting the code reads", () => {
  const read = settingsReadBySource();
  assert.ok(read.size > 0, "found no TARE_ settings in source");
  const passed = composeEnvironmentKeys();
  const missing = [...read].filter((name) => !passed.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `missing from compose.example.yaml: ${missing}`,
  );
});
