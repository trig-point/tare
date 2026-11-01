#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const allowedHosts = new Set([
  "example.com",
  "example.org",
  "localhost",
  "127.0.0.1",
]);
const entries = (process.env.TARE_HYGIENE_DENY ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase());
for (const [index, entry] of entries.entries()) {
  if (entry && !/^\.?[a-z0-9][a-z0-9.-]*$/.test(entry)) {
    console.error(`TARE_HYGIENE_DENY entry ${index + 1} is not a host name`);
    process.exit(1);
  }
}
const configured = entries.filter(Boolean);
let forkPullRequest = false;
// GitHub's event payload identifies fork PRs by differing head and base repository names.
// Missing repository metadata cannot prove a fork, so CI still requires the secret.
if (
  process.env.GITHUB_EVENT_NAME === "pull_request" &&
  process.env.GITHUB_EVENT_PATH
) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const head = event.pull_request?.head?.repo?.full_name;
  const base = event.pull_request?.base?.repo?.full_name;
  forkPullRequest =
    typeof head === "string" && typeof base === "string" && head !== base;
}
if (process.env.CI === "true" && configured.length === 0) {
  if (!forkPullRequest) {
    console.error("TARE_HYGIENE_DENY is required in CI.");
    process.exit(1);
  }
  console.warn(
    "Warning: fork PR secrets unavailable; running generic hygiene checks only.",
  );
}
const generic = readFileSync(
  fileURLToPath(new URL("./hygiene-deny.txt", import.meta.url)),
  "utf8",
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const denied = [...generic, ...(forkPullRequest ? [] : configured)]
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const names = new Set(denied.filter((value) => !value.includes(".")));
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
let failed = false;
let scanned = 0;
for (const file of files) {
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  scanned += 1;
  const lines = content.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const rules = new Set<string>();
    const segments = line
      .toLowerCase()
      .split(/[\\/]+/)
      .filter(Boolean);
    for (const [segmentIndex, segment] of segments.entries()) {
      if (segment !== "users" && segment !== "home") continue;
      const account = segments[segmentIndex + 1]?.split(/[\s"'`]/, 1)[0];
      if (account !== undefined && names.has(account)) rules.add("denied-name");
    }
    const hosts =
      line.toLowerCase().match(/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) ?? [];
    for (const host of hosts) {
      if (allowedHosts.has(host) || host === "env.local") continue;
      for (const value of denied) {
        const matches = value.startsWith(".")
          ? host.endsWith(value)
          : `.${host}.`.includes(`.${value}.`);
        if (matches)
          rules.add(value.includes(".") ? "denied-host" : "denied-name");
      }
    }
    for (const rule of rules) {
      console.error(`${file}:${index + 1}: ${rule}`);
      failed = true;
    }
  }
}
if (!failed) {
  console.log(
    `hygiene: scanned ${scanned} files, ${denied.length} deny entries`,
  );
}
process.exitCode = failed ? 1 : 0;
