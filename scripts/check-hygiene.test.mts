import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hygieneCases } from "./check-hygiene.cases.mts";

const script = fileURLToPath(new URL("./check-hygiene.mts", import.meta.url));
const HANG_CEILING_MS = 60_000;
function check(
  content: string | Buffer,
  environment: Record<string, string | undefined> = {},
  filename: string | null = "sample.txt",
  headRepository: string | null = "contributor/tare",
  options: {
    symlinkTarget?: string;
    additionalFiles?: Record<string, string>;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "tare-hygiene-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    if (filename !== null) {
      mkdirSync(dirname(join(directory, filename)), { recursive: true });
      if (options.symlinkTarget !== undefined) {
        symlinkSync(options.symlinkTarget, join(directory, filename));
      } else {
        writeFileSync(join(directory, filename), content);
      }
    }
    for (const [additionalPath, additionalContent] of Object.entries(
      options.additionalFiles ?? {},
    )) {
      mkdirSync(dirname(join(directory, additionalPath)), { recursive: true });
      writeFileSync(join(directory, additionalPath), additionalContent);
    }
    writeFileSync(
      join(directory, "event.json"),
      JSON.stringify({
        pull_request: {
          head: {
            repo:
              headRepository === null ? null : { full_name: headRepository },
          },
          base: { repo: { full_name: "project/tare" } },
        },
      }),
    );
    const tracked = [
      ...(filename === null ? [] : [filename]),
      ...Object.keys(options.additionalFiles ?? {}),
    ];
    if (tracked.length > 0)
      execFileSync("git", ["add", "--", ...tracked], { cwd: directory });
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: "utf8",
      timeout: HANG_CEILING_MS,
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
test("clean and empty text files pass", () => {
  assert.equal(check("clean").status, 0);
  assert.equal(check("").status, 0);
});
test("binary files skip planted denied hosts", () => {
  assert.equal(
    check(
      Buffer.concat([Buffer.from([0]), Buffer.from("secret-host.invalid")]),
      { TARE_HYGIENE_DENY: "secret-host.invalid" },
      "sample.txt",
      "contributor/tare",
      { additionalFiles: { "clean.txt": "clean" } },
    ).status,
    0,
  );
});

test("invalid deny entries report their position without their value", () => {
  for (const value of [
    "https://secret-host.invalid",
    "private_host",
    "*.invalid",
    "host:8080",
    "private host",
    "[::1]",
  ]) {
    const result = check("clean", {
      TARE_HYGIENE_DENY: `example.com,,${value}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.output, /entry 3 is not a host name/);
    assert.equal(result.output.includes(value), false);
  }
});

test("comma-only deny configuration is unset in CI", () => {
  for (const value of [",,", " , , "]) {
    const result = check("clean", { CI: "true", TARE_HYGIENE_DENY: value });
    assert.equal(result.status, 1);
    assert.match(result.output, /TARE_HYGIENE_DENY is required in CI/);
  }
});

test("lockfiles are scanned for denied names and hosts", () => {
  for (const content of [
    ["", "home", "alice", "file"].join("/"),
    "secret-host.invalid",
  ]) {
    const result = check(
      content,
      { TARE_HYGIENE_DENY: "alice,secret-host.invalid" },
      "pnpm-lock.yaml",
    );
    assert.equal(result.status, 1);
    assert.match(result.output, /pnpm-lock.yaml:1: (denied-name|denied-host)/);
  }
});

test("same-repo PR requires the CI secret", () => {
  const result = check(
    "clean",
    { CI: "true", GITHUB_EVENT_NAME: "pull_request" },
    "sample.txt",
    "project/tare",
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /TARE_HYGIENE_DENY is required in CI/);
  assert.equal(result.output.includes("Warning:"), false);
});

test("push requires the CI secret", () => {
  const result = check("clean", { CI: "true", GITHUB_EVENT_NAME: "push" });
  assert.equal(result.status, 1);
  assert.match(result.output, /TARE_HYGIENE_DENY is required in CI/);
});

test("PR with missing head repository requires the CI secret", () => {
  const result = check(
    "clean",
    { CI: "true", GITHUB_EVENT_NAME: "pull_request" },
    "sample.txt",
    null,
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /TARE_HYGIENE_DENY is required in CI/);
  assert.equal(result.output.includes("Warning:"), false);
});

test("success reports presence without the configured count", () => {
  const clean = check("clean");
  assert.equal(clean.status, 0);
  assert.match(
    clean.output,
    /^hygiene: scanned 1 files; configured deny list: absent; generic patterns: \d+\n$/,
  );
  const configured = check("clean", {
    TARE_HYGIENE_DENY: "secret-host.invalid,other.invalid",
  });
  assert.equal(configured.status, 0);
  assert.match(
    configured.output,
    /^hygiene: scanned 1 files; configured deny list: present; generic patterns: \d+\n$/,
  );
  assert.equal(
    configured.output,
    check("clean", {
      TARE_HYGIENE_DENY: "secret-host.invalid,other.invalid,third.invalid",
    }).output,
  );
  const failed = check("secret-host.invalid", {
    TARE_HYGIENE_DENY: "secret-host.invalid",
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.output.includes("hygiene: scanned"), false);
});

test("finding paths redact denied values case-insensitively", () => {
  for (const [content, filename, denied, rule] of [
    [
      "secret-host.invalid",
      "Secret-Host.Invalid.conf",
      "secret-host.invalid",
      "denied-host",
    ],
    [
      ["", "home", "alice", "file"].join("/"),
      "Alice.conf",
      "alice",
      "denied-name",
    ],
  ] as const) {
    const result = check(content, { TARE_HYGIENE_DENY: denied }, filename);
    assert.equal(result.status, 1);
    assert.equal(
      result.output,
      `${denied === "alice" ? "<redacted path>:0: denied-path\n" : ""}<redacted path>:1: ${rule}\n`,
    );
    assert.equal(result.output.toLowerCase().includes(denied), false);
  }
});

test("deny entries require valid labels", () => {
  for (const value of ["corp.net.", "a..b", "corp-", "-corp"]) {
    const result = check("clean", {
      TARE_HYGIENE_DENY: `example.com,,${value}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.output, /entry 3 is not a host name/);
    assert.equal(result.output.includes(value), false);
  }
  assert.equal(
    check("clean", { TARE_HYGIENE_DENY: "a,a-b,.corp.net" }).status,
    0,
  );
});

test("unreadable tracked files redact paths and keep scanning", () => {
  const result = check(
    "",
    { TARE_HYGIENE_DENY: "secret-host.invalid" },
    "Secret-Host.Invalid.conf",
    "contributor/tare",
    {
      symlinkTarget: "missing-target",
      additionalFiles: { "safe.txt": "secret-host.invalid" },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /<redacted path>:0: unreadable/);
  assert.match(result.output, /safe.txt:1: denied-host/);
  assert.equal(
    result.output.toLowerCase().includes("secret-host.invalid"),
    false,
  );
});

test("scans with no readable text files fail", () => {
  for (const result of [check("", {}, null), check(Buffer.from([0]))]) {
    assert.equal(result.status, 1);
    assert.match(result.output, /hygiene: no files scanned/);
    assert.equal(result.output.includes("hygiene: scanned"), false);
  }
});

for (const row of hygieneCases) {
  test(`case table: ${row.label}`, () => {
    const result = check(
      row.content,
      { TARE_HYGIENE_DENY: "alice,secret-host.invalid" },
      "filename" in row ? row.filename : "sample.txt",
    );
    assert.equal(result.status, row.status, result.output);
  });
}
