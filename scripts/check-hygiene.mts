#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const placeholders = new Set([
  "<name>",
  "example",
  "you",
  "user",
  "username",
  "<user>",
  "$user",
  "runner",
]);
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
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
let failed = false;
for (const file of files) {
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  const lines = content.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const homePaths = line.matchAll(
      /(?:(?<![\w.-])(?:\\?\/)+(?:users|home)(?:\\?\/)+([^\\/\s"']+)|[a-z]:[\\/]+users[\\/]+([^\\/\s"']+))/gi,
    );
    if (
      [...homePaths].some((match) => {
        const username = match[1] ?? match[2];
        return (
          username !== undefined && !placeholders.has(username.toLowerCase())
        );
      })
    ) {
      console.error(`${file}:${index + 1}: home-path`);
      failed = true;
    }
    const hosts =
      line.toLowerCase().match(/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) ?? [];
    if (
      hosts.some(
        (host) =>
          !allowedHosts.has(host) &&
          host !== "env.local" &&
          denied.some((value) =>
            value.startsWith(".")
              ? host.endsWith(value)
              : `.${host}.`.includes(`.${value}.`),
          ),
      )
    ) {
      console.error(`${file}:${index + 1}: denied-host`);
      failed = true;
    }
  }
}
process.exitCode = failed ? 1 : 0;
