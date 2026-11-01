import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
    allowPatterns?: string;
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
    let scanner = script;
    if (options.allowPatterns !== undefined) {
      const runner = join(directory, ".scanner");
      mkdirSync(runner);
      scanner = join(runner, "check-hygiene.mts");
      writeFileSync(scanner, readFileSync(script));
      writeFileSync(join(runner, "hygiene-allow.txt"), options.allowPatterns);
    }
    const result = spawnSync(process.execPath, [scanner], {
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
test("configured documentation domains are checked", () => {
  assert.equal(
    check("example.com example.org localhost 127.0.0.1", {
      TARE_HYGIENE_DENY: "example.com,example.org,localhost,127.0.0.1",
    }).status,
    1,
  );
});
test("CI rejects missing and empty configuration", () => {
  for (const value of [undefined, "", "   "]) {
    const result = check("clean", { CI: "true", TARE_HYGIENE_DENY: value });
    assert.equal(result.status, 1);
    assert.match(result.output, /TARE_HYGIENE_DENY is required in CI/);
  }
});
test("fork PR warns and skips unavailable configured checks", () => {
  const environment = { CI: "true", GITHUB_EVENT_NAME: "pull_request" };
  const clean = check("clean", environment);
  assert.equal(clean.status, 0);
  assert.match(clean.output, /Warning: fork PR/);
  assert.equal(
    check("secret-host.invalid", {
      ...environment,
      TARE_HYGIENE_DENY: "secret-host.invalid",
    }).status,
    0,
  );
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
    /^hygiene: scanned 1 files; configured deny list: absent\n$/,
  );
  const configured = check("clean", {
    TARE_HYGIENE_DENY: "secret-host.invalid,other.invalid",
  });
  assert.equal(configured.status, 0);
  assert.match(
    configured.output,
    /^hygiene: scanned 1 files; configured deny list: present\n$/,
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
      `<redacted path>:0: denied-path\n<redacted path>:1: ${rule}\n`,
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
    check("clean", { TARE_HYGIENE_DENY: "abc,a-b,.corp.net" }).status,
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
      {
        TARE_HYGIENE_DENY:
          "deny" in row ? row.deny : "alice,secret-host.invalid,corp.net",
      },
      "filename" in row ? row.filename : "sample.txt",
    );
    assert.equal(result.status, row.status, result.output);
  });
}

test("short dotless deny entries fail validation", () => {
  for (const entry of ["a", "ab"]) {
    const result = check("clean", { TARE_HYGIENE_DENY: entry });
    assert.equal(result.status, 1);
  }
});
test("output guard redacts leading-dot entries in filenames", () => {
  const result = check(
    "secret-host.invalid",
    { TARE_HYGIENE_DENY: ".secret-host.invalid" },
    "Secret-Host.Invalid.conf",
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /<redacted path>/);
  assert.equal(
    result.output.toLowerCase().includes("secret-host.invalid"),
    false,
  );
});
test("output guard hides rule text containing a denied entry", () => {
  const result = check("path", { TARE_HYGIENE_DENY: "path" }, "docs/path.md");
  assert.equal(result.status, 1);
  assert.match(result.output, /hygiene: finding hidden/);
  assert.equal(result.output.includes("path"), false);
});
test("output guard rejects unsafe success text", () => {
  const result = check("clean", { TARE_HYGIENE_DENY: "present" });
  assert.equal(result.status, 1);
  assert.match(result.output, /hygiene: finding hidden/);
  assert.equal(result.output.includes("present"), false);
});

test("output guard stays silent when fallback contains a denied entry", () => {
  const result = check("denied", { TARE_HYGIENE_DENY: "denied" });
  assert.equal(result.status, 1);
  assert.equal(result.output, "");
});

test("invalid allow patterns report line numbers and are skipped", () => {
  const result = check(
    "github.com/alice/repo",
    { TARE_HYGIENE_DENY: "alice" },
    "sample.txt",
    "contributor/tare",
    {
      allowPatterns:
        "# reason\ngithub.com/\n{name}/{name}\ngithub.com/{name}\n",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /hygiene-allow.txt:2:/);
  assert.match(result.output, /hygiene-allow.txt:3:/);
  assert.equal(result.output.includes("denied-name"), false);
  assert.equal(result.output.includes("alice"), false);
});
test("finding on line three reports its location", () => {
  const result = check("clean\nclean\n/home/alice", {
    TARE_HYGIENE_DENY: "alice",
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /sample.txt:3: denied-name/);
});
