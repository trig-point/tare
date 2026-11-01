#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entries = (process.env.TARE_HYGIENE_DENY ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase());
const configured = entries.filter(Boolean);
let failed = false;

function output(message: string, error = true) {
  const containsDenied = (text: string) =>
    configured.some((entry) =>
      text.toLowerCase().includes(entry.replace(/^\./, "")),
    );
  if (containsDenied(message)) {
    const fallback =
      "hygiene: finding hidden (output would contain a denied value)";
    if (!containsDenied(fallback)) console.error(fallback);
    failed = true;
    return;
  }
  if (error) console.error(message);
  else console.log(message);
}

function run() {
  for (const [index, entry] of entries.entries()) {
    const labels = (entry.startsWith(".") ? entry.slice(1) : entry).split(".");
    if (
      entry &&
      (!labels.every((label) =>
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      ) ||
        (!entry.includes(".") && entry.length < 3))
    ) {
      output(
        `TARE_HYGIENE_DENY entry ${index + 1} is not a host name of sufficient length`,
      );
      failed = true;
      return;
    }
  }
  let forkPullRequest = false;
  // Missing repository metadata cannot prove a fork, so CI still requires the secret.
  if (
    process.env.GITHUB_EVENT_NAME === "pull_request" &&
    process.env.GITHUB_EVENT_PATH
  ) {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const head = event.pull_request?.head?.repo?.full_name;
    const base = event.pull_request?.base?.repo?.full_name;
    forkPullRequest =
      typeof head === "string" && typeof base === "string" && head !== base;
  }
  if (process.env.CI === "true" && configured.length === 0) {
    if (!forkPullRequest) {
      output("TARE_HYGIENE_DENY is required in CI.");
      failed = true;
      return;
    }
    output(
      "Warning: fork PR secrets unavailable; configured hygiene checks skipped.",
    );
  }
  const allowed = readFileSync(
    fileURLToPath(new URL("./hygiene-allow.txt", import.meta.url)),
    "utf8",
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const denied = forkPullRequest ? [] : configured;
  function findRules(line: string): Set<string> {
    const lower = line.toLowerCase();
    const rules = new Set<string>();
    for (const entry of denied) {
      const name = entry.replace(/^\./, "");
      const dotted = entry.includes(".");
      const contexts = dotted
        ? []
        : allowed.flatMap((pattern) => {
            const expression = pattern
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
              .replace(
                "\\{name\\}",
                name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              )
              .replace("\\{year\\}", "[0-9]{4}");
            return [...lower.matchAll(new RegExp(expression, "g"))].map(
              (match) => match.index + match[0].lastIndexOf(name),
            );
          });
      let cursor = 0;
      while (cursor < lower.length) {
        const start = lower.indexOf(name, cursor);
        if (start === -1) break;
        cursor = start + name.length;
        const before = lower.charAt(start - 1);
        const after = lower.charAt(cursor);
        const boundary =
          !/[a-z0-9]/.test(before) &&
          !/[a-z0-9]/.test(after) &&
          (!dotted || before !== "-");
        if (!boundary || contexts.includes(start)) continue;
        rules.add(dotted ? "denied-host" : "denied-name");
      }
    }
    return rules;
  }
  const files = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean);
  let scanned = 0;
  for (const file of files) {
    const reportedPath = configured.some((entry) =>
      file.toLowerCase().includes(entry.replace(/^\./, "")),
    )
      ? "<redacted path>"
      : file;
    if (findRules(file).size > 0) {
      output(`${reportedPath}:0: denied-path`);
      failed = true;
    }
    let content: Buffer;
    try {
      content = readFileSync(file);
    } catch {
      output(`${reportedPath}:0: unreadable`);
      failed = true;
      continue;
    }
    if (content.includes(0)) continue;
    scanned += 1;
    for (const [index, line] of content
      .toString("utf8")
      .split(/\r?\n/)
      .entries()) {
      for (const rule of findRules(line)) {
        output(`${reportedPath}:${index + 1}: ${rule}`);
        failed = true;
      }
    }
  }
  if (scanned === 0) {
    output("hygiene: no files scanned");
    failed = true;
  }
  if (!failed)
    output(
      `hygiene: scanned ${scanned} files; configured deny list: ${!forkPullRequest && configured.length > 0 ? "present" : "absent"}`,
      false,
    );
}
try {
  run();
} catch {
  output("hygiene: check failed");
  failed = true;
}
process.exitCode = failed ? 1 : 0;
