import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-hygiene.mts", import.meta.url));
function check(
  content: string | Buffer,
  environment: Record<string, string | undefined> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "tare-hygiene-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    writeFileSync(join(directory, "sample.txt"), content);
    writeFileSync(
      join(directory, "event.json"),
      JSON.stringify({
        pull_request: {
          head: { repo: { full_name: "contributor/tare" } },
          base: { repo: { full_name: "project/tare" } },
        },
      }),
    );
    execFileSync("git", ["add", "sample.txt"], { cwd: directory });
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "",
        TARE_HYGIENE_DENY: "",
        GITHUB_EVENT_NAME: "",
        GITHUB_EVENT_PATH: join(directory, "event.json"),
        ...environment,
      },
    });
    assert.equal(result.error, undefined);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("home paths report file and line across platforms", () => {
  for (const path of [
    `/${"Users"}/alice/`,
    `/${"home"}/alice/`,
    ["C:", "Users", "alice", ""].join("\\"),
    ["C:", "Users", "alice", ""].join("/"),
  ]) {
    const result = check(`safe\n${path}data`);
    assert.equal(result.status, 1);
    assert.match(result.output, /sample.txt:2: home-path/);
  }
});
test("denied hosts report location without disclosing the configured value", () => {
  const result = check("secret-host.invalid", {
    TARE_HYGIENE_DENY: "secret-host.invalid",
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /sample.txt:1: denied-host/);
  assert.equal(result.output.includes("secret-host.invalid"), false);
});
test("documentation domains remain allowed even when denied", () => {
  assert.equal(
    check("example.com example.org localhost 127.0.0.1", {
      TARE_HYGIENE_DENY: "example.com,example.org,localhost,127.0.0.1",
    }).status,
    0,
  );
});
test("CI rejects missing and empty configuration", () => {
  for (const value of [undefined, "", "   "]) {
    const result = check("clean", { CI: "true", TARE_HYGIENE_DENY: value });
    assert.equal(result.status, 1);
    assert.match(result.output, /TARE_HYGIENE_DENY is required in CI/);
  }
});
test("fork PR warns while retaining generic checks", () => {
  const environment = { CI: "true", GITHUB_EVENT_NAME: "pull_request" };
  const clean = check("clean", environment);
  assert.equal(clean.status, 0);
  assert.match(clean.output, /Warning: fork PR/);
  assert.equal(check(["printer", "local"].join("."), environment).status, 1);
});
test("clean and empty repositories pass", () => {
  assert.equal(check("clean").status, 0);
  assert.equal(check("").status, 0);
});
test("placeholders and binary files pass", () => {
  assert.equal(check(`/${"home"}/<name>/file`).status, 0);
  assert.equal(check(Buffer.from([0, 255, 100])).status, 0);
});
test("generic domains match host boundaries", () => {
  assert.equal(check(["printer", "local"].join(".")).status, 1);
  assert.equal(check("printer.locality").status, 0);
});
