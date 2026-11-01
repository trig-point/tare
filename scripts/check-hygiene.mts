#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function urlRanges(line: string) {
  const ranges: Array<{
    start: number;
    end: number;
    hostStart: number;
    hostEnd: number;
  }> = [];
  let cursor = 0;
  while (cursor < line.length) {
    const marker = line.indexOf("://", cursor);
    if (marker === -1) break;
    let start = marker;
    while (start > 0 && /[a-z0-9+.-]/.test(line.charAt(start - 1))) start -= 1;
    if (!/[a-z]/.test(line.charAt(start))) {
      cursor = marker + 3;
      continue;
    }
    let end = marker + 3;
    while (end < line.length && !/[\s"'`<>)\]]/.test(line.charAt(end)))
      end += 1;
    const remainder = line.slice(marker + 3, end);
    const delimiter = remainder.search(/[/?#]/);
    const authority =
      delimiter === -1 ? remainder : remainder.slice(0, delimiter);
    const hostOffset = authority.lastIndexOf("@") + 1;
    const port = authority.indexOf(":", hostOffset);
    ranges.push({
      start,
      end,
      hostStart: marker + 3 + hostOffset,
      hostEnd: marker + 3 + (port === -1 ? authority.length : port),
    });
    cursor = end;
  }
  return ranges;
}

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
const names = new Set(denied.filter((value) => !value.includes(".")));
function findRules(line: string) {
  const rules = new Set<string>();
  const lowerLine = line.toLowerCase();
  const urls = urlRanges(lowerLine);
  const accountParts: string[] = [];
  let accountCursor = 0;
  for (const url of urls) {
    accountParts.push(lowerLine.slice(accountCursor, url.start), " ");
    accountCursor = url.end;
  }
  accountParts.push(lowerLine.slice(accountCursor));
  const accountLine = accountParts.join("");
  for (const match of accountLine.matchAll(/(?:^|[\s"'`=(])~([a-z0-9._-]+)/g)) {
    const account = match[1]?.replace(/\.$/, "");
    if (account !== undefined && names.has(account)) rules.add("denied-name");
  }
  const segments = accountLine.split(/[\\/]+/).filter(Boolean);
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment !== "users" && segment !== "home") continue;
    const account = segments[segmentIndex + 1]
      ?.match(/^[a-z0-9._-]+/i)?.[0]
      .replace(/\.$/, "");
    if (account !== undefined && names.has(account)) rules.add("denied-name");
  }
  let urlIndex = 0;
  const hosts = lowerLine.matchAll(/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g);
  for (const match of hosts) {
    let host = match[0];
    let url = urls[urlIndex];
    while (url && match.index >= url.end) {
      urlIndex += 1;
      url = urls[urlIndex];
    }
    if (
      url &&
      match.index >= url.start &&
      (match.index < url.hostStart || match.index + host.length > url.hostEnd)
    )
      continue;
    if (allowedHosts.has(host)) continue;
    const labels = host.split(".");
    const previous = lowerLine[match.index - 1];
    const next = lowerLine[match.index + host.length];
    const prefix = lowerLine.slice(Math.max(0, match.index - 3), match.index);
    const urlHost = prefix.endsWith("://") || prefix.endsWith("//");
    const pathSegment =
      !urlHost &&
      (previous === undefined || /[\\/\s"'`(]/.test(previous)) &&
      (next === undefined || /[\\/\s"'`,;:.)\]]/.test(next));
    if (
      labels[0] === "env" &&
      labels[1] === "local" &&
      (previous === "." || pathSegment)
    ) {
      host = labels.slice(2).join(".");
      if (!host) continue;
    }
    for (const value of denied) {
      const authorityHost =
        url !== undefined &&
        match.index === url.hostStart &&
        match.index + match[0].length === url.hostEnd;
      if (!value.includes(".") && !match[0].includes(".") && !authorityHost)
        continue;
      const matches = value.startsWith(".")
        ? host.endsWith(value)
        : `.${host}.`.includes(`.${value}.`);
      if (matches)
        rules.add(value.includes(".") ? "denied-host" : "denied-name");
    }
  }
  return rules;
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
