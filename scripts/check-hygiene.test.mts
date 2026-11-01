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
  filename: string | null = "sample.txt",
  headRepository: string | null = "contributor/tare",
) {
  const directory = mkdtempSync(join(tmpdir(), "tare-hygiene-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    if (filename !== null) writeFileSync(join(directory, filename), content);
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
    if (filename !== null)
      execFileSync("git", ["add", filename], { cwd: directory });
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
test("binary files skip planted denied hosts", () => {
  assert.equal(
    check(
      Buffer.concat([Buffer.from([0]), Buffer.from("secret-host.invalid")]),
      { TARE_HYGIENE_DENY: "secret-host.invalid" },
    ).status,
    0,
  );
});
test("generic domains match host boundaries", () => {
  assert.equal(check(["printer", "local"].join(".")).status, 1);
  assert.equal(check("printer.locality").status, 0);
});

test("denied names match whole label sequences", () => {
  for (const [host, denied, expected] of [
    ["private-box.tail1234.ts.net", "private-box", 1],
    ["sub.secret-host.invalid", "secret-host.invalid", 1],
    ["notsecret-host.invalid", "secret-host.invalid", 0],
    ["notprivate-box.tail1234.ts.net", "private-box", 0],
  ] as const) {
    const result = check(host, { TARE_HYGIENE_DENY: denied });
    assert.equal(result.status, expected, host);
    assert.equal(result.output.includes(denied), false);
  }
});

test("environment file names are not hosts", () => {
  for (const content of [
    ["env", "local"].join("."),
    ["", "env", "local"].join("."),
  ]) {
    assert.equal(check(content).status, 0);
  }
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
  assert.equal(
    clean.output,
    "hygiene: scanned 1 files; configured deny list: absent; generic patterns: 1\n",
  );
  const configured = check("clean", {
    TARE_HYGIENE_DENY: "secret-host.invalid,other.invalid",
  });
  assert.equal(configured.status, 0);
  assert.equal(
    configured.output,
    "hygiene: scanned 1 files; configured deny list: present; generic patterns: 1\n",
  );
  assert.equal(
    configured.output,
    check("clean", {
      TARE_HYGIENE_DENY: "secret-host.invalid,other.invalid,third.invalid",
    }).output,
  );
  assert.equal(
    check("", {}, null).output,
    "hygiene: scanned 0 files; configured deny list: absent; generic patterns: 1\n",
  );
  const failed = check("secret-host.invalid", {
    TARE_HYGIENE_DENY: "secret-host.invalid",
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.output.includes("hygiene: scanned"), false);
});

test("configured names match account segments and host labels", () => {
  for (const separator of ["/", "\\", "\\\\", "\\/"]) {
    for (const parent of ["Users", "HOME"]) {
      for (const prefix of ["", "C:", ["", "mnt", "c"].join(separator)]) {
        const result = check(
          [prefix, parent, "ALICE", "file"].join(separator),
          { TARE_HYGIENE_DENY: "alice" },
        );
        assert.equal(result.status, 1);
        assert.match(result.output, /sample.txt:1: denied-name/);
        assert.equal(result.output.includes("alice"), false);
      }
    }
  }
  assert.match(
    check("sub.private-box.invalid", { TARE_HYGIENE_DENY: "private-box" })
      .output,
    /denied-name/,
  );
});

test("generic home paths and routes pass without a denied name", () => {
  for (const content of [
    ["", "home", "node", "app"].join("/"),
    ["", "Users", "<user>"].join("/"),
    'app.get("/users/:id", handler)',
  ]) {
    assert.equal(
      check(content, { TARE_HYGIENE_DENY: "private-box" }).status,
      0,
    );
  }
});

test("long separator lines complete", () => {
  const result = check("/".repeat(200_000));
  assert.equal(result.status, 0);
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
    assert.equal(result.output, `<redacted path>:1: ${rule}\n`);
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

test("environment file exemption excludes URL hosts", () => {
  const filename = ["env", "local"].join(".");
  for (const content of [
    `.${filename}`,
    `.${filename}.example`,
    `config/${filename}`,
    `config\\${filename}`,
    filename,
  ]) {
    assert.equal(check(content).status, 0, content);
  }
  for (const environment of [{}, { TARE_HYGIENE_DENY: filename }]) {
    const result = check(`https://${filename}/`, environment);
    assert.equal(result.status, 1);
    assert.match(result.output, /sample.txt:1: denied-host/);
  }
});

test("dotless names match account paths and dotted hosts only", () => {
  for (const [content, expected] of [
    ["Copyright alice", 0],
    ["github.com/alice/repo", 0],
    [["", "Users", "alice", "x"].join("/"), 1],
    ["alice.example-tailnet.ts.net", 1],
  ] as const) {
    const result = check(content, { TARE_HYGIENE_DENY: "alice" });
    assert.equal(result.status, expected, content);
    if (expected === 1) assert.match(result.output, /denied-name/);
  }
});

test("account segments stop at punctuation", () => {
  for (const content of [
    `HOME=${["", "home", "alice;"].join("/")}`,
    `(see ${["", "Users", "alice)"].join("/")}`,
    `cwd=${["", "Users", "alice,"].join("/")}`,
    ["", "home", "ALICE."].join("/"),
  ]) {
    const result = check(content, { TARE_HYGIENE_DENY: "alice" });
    assert.equal(result.status, 1);
    assert.match(result.output, /denied-name/);
  }
});

test("environment filename exemption still checks remaining labels", () => {
  for (const prefix of ["", ".", "config/"]) {
    for (const [suffix, rule] of [
      ["secret-host.invalid", "denied-host"],
      ["private-box", "denied-name"],
    ] as const) {
      const content = `${prefix}${["env", "local", suffix].join(".")}`;
      const result = check(content, { TARE_HYGIENE_DENY: suffix });
      assert.equal(result.status, 1);
      assert.match(result.output, new RegExp(`sample.txt:1: ${rule}`));
      assert.equal(result.output.includes(suffix), false);
    }
  }
});

test("URL host checks exclude paths queries fragments and user info", () => {
  for (const content of [
    "https://github.com/alice.example/repo",
    "https://alice.example@github.com:443/repo",
    "https://github.com?next=alice.example",
    "https://github.com#alice.example",
    "https://github.com/secret-host.invalid",
  ]) {
    assert.equal(
      check(content, { TARE_HYGIENE_DENY: "alice,secret-host.invalid" }).status,
      0,
      content,
    );
  }
  for (const content of [
    "https://alice.example/repo",
    "https://login@alice.example:443/repo",
    "https://secret-host.invalid:443/alice.example",
    "alice.example",
    "safe https://github.com/alice.example next alice.example",
  ]) {
    assert.equal(
      check(content, { TARE_HYGIENE_DENY: "alice,secret-host.invalid" }).status,
      1,
      content,
    );
  }
});
