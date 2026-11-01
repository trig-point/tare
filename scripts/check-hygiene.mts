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
  const labels = (entry.startsWith(".") ? entry.slice(1) : entry).split(".");
  if (
    entry &&
    !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
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
function pathNames(token: string): string[] {
  const segments = token.replace(/\\([\\/])/g, "$1").split(/[\\/]+/);
  const names: string[] = [];
  if (segments[0]?.startsWith("~")) names.push(segments[0].slice(1));
  for (const [index, segment] of segments.entries()) {
    if (segment === "users" || segment === "home") {
      const name = segments[index + 1];
      if (name) names.push(name.replace(/\.$/, ""));
    }
  }
  return names;
}

function hostLabels(token: string): string[] {
  const basename = token.split(/[\\/]+/).at(-1) ?? token;
  const host = basename.replace(/[.:]+$/, "");
  if (host.startsWith(".") || /^env\.local(?:\.|$)/.test(host)) return [];
  if (!host.includes(".")) return [];
  return host
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    ? host.split(".")
    : [];
}

function matchingRules(names: string[], hosts: string[]): Set<string> {
  const rules = new Set<string>();
  for (const value of denied) {
    const suffix = value.replace(/^\./, "");
    const dotted = value.includes(".");
    const hostMatch = hosts.some((host) => {
      if (allowedHosts.has(host)) return false;
      return dotted
        ? host === suffix || host.endsWith(`.${suffix}`)
        : host.split(".").includes(value);
    });
    if (hostMatch || (!dotted && names.includes(value)))
      rules.add(dotted ? "denied-host" : "denied-name");
  }
  return rules;
}

function findRules(line: string): Set<string> {
  const hosts: string[] = [];
  const names: string[] = [];
  const remainder = line
    .toLowerCase()
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>)\]]*/g, (candidate) => {
      try {
        hosts.push(new URL(candidate).hostname.replace(/\.$/, ""));
      } catch {
        // Invalid URL candidates remain available to the ordinary token checks.
        return candidate;
      }
      return " ";
    });
  for (const token of remainder.split(/[\s"'`()[\]{}<>,;=|]+/)) {
    names.push(...pathNames(token));
    const labels = hostLabels(token);
    if (labels.length > 0) hosts.push(labels.join("."));
  }
  return matchingRules(names, hosts);
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
let failed = false;
let scanned = 0;
for (const file of files) {
  const reportedPath = denied.some((value) =>
    file.toLowerCase().includes(value),
  )
    ? "<redacted path>"
    : file;
  if (findRules(file).size > 0) {
    console.error("<redacted path>:0: denied-path");
    failed = true;
  }
  let content: Buffer;
  try {
    content = readFileSync(file);
  } catch {
    console.error(`${reportedPath}:0: unreadable`);
    failed = true;
    continue;
  }
  if (content.includes(0)) continue;
  scanned += 1;
  const lines = content.toString("utf8").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const rules = findRules(line);
    for (const rule of rules) {
      console.error(`${reportedPath}:${index + 1}: ${rule}`);
      failed = true;
    }
  }
}
if (scanned === 0) {
  console.error("hygiene: no files scanned");
  failed = true;
}
if (!failed) {
  const presence =
    !forkPullRequest && configured.length > 0 ? "present" : "absent";
  console.log(
    `hygiene: scanned ${scanned} files; configured deny list: ${presence}; generic patterns: ${generic.length}`,
  );
}
process.exitCode = failed ? 1 : 0;
