export const hygieneCases = [
  {
    label: "Unix home",
    content: "/Users/alice/",
    status: 1,
  },
  {
    label: "Windows home",
    content: "C:\\Users\\alice\\",
    status: 1,
  },
  {
    label: "escaped Windows",
    content: "C:\\\\Users\\\\alice\\\\",
    status: 1,
  },
  {
    label: "escaped Unix",
    content: "\\/Users\\/alice\\/",
    status: 1,
  },
  {
    label: "mounted home",
    content: "/mnt/c/Users/alice/",
    status: 1,
  },
  {
    label: "assignment",
    content: "HOME=/home/alice",
    status: 1,
  },
  {
    label: "parentheses",
    content: "(see /Users/alice)",
    status: 1,
  },
  {
    label: "tilde",
    content: "~alice/.ssh/config",
    status: 1,
  },
  {
    label: "host label",
    content: "alice.tailnet.test",
    status: 1,
  },
  {
    label: "URL port",
    content: "http://alice:8123/",
    status: 1,
  },
  {
    label: "badge",
    content:
      "[![CI](https://img.shields.io/badge/x)](https://secret-host.invalid/p)",
    status: 1,
  },
  {
    label: "GitHub path",
    content: "github.com/alice/repo",
    status: 0,
  },
  {
    label: "route",
    content: "/users/:id",
    status: 0,
  },
  {
    label: "container mount",
    content: "-v /home/node/app",
    status: 0,
  },
  {
    label: "copyright",
    content: "Copyright (c) 2026 alice",
    status: 0,
  },
  {
    label: "hidden env",
    content: ".env.local",
    status: 0,
  },
  {
    label: "env punctuation",
    content: "env.local,",
    status: 0,
  },
  {
    label: "label boundary",
    content: "notalice.tailnet.test",
    status: 0,
  },
  {
    label: "dotted suffix",
    content: "sub.secret-host.invalid",
    status: 1,
  },
  {
    label: "second token",
    content: "safe https://github.com/alice.example next alice.example",
    status: 1,
  },
  {
    label: "uppercase",
    content: "HOME=/HOME/ALICE;",
    status: 1,
  },
  {
    label: "terminal dot",
    content: "/home/alice.",
    status: 1,
  },
  {
    label: "env example",
    content: ".env.local.example",
    status: 0,
  },
  {
    label: "env colon",
    content: "env.local:",
    status: 0,
  },
  {
    label: "generic boundary",
    content: "printer.locality",
    status: 0,
  },
  {
    label: "quoted host",
    content: '"alice.tailnet.test"',
    status: 1,
  },
  {
    label: "trailing dot URL",
    content: "https://alice./",
    status: 1,
  },
  {
    label: "tracked dotted name",
    content: "clean",
    status: 1,
    filename: "docs/alice.md",
  },
  {
    label: "tracked home",
    content: "clean",
    status: 1,
    filename: "home/alice/data.txt",
  },
  {
    label: "tracked partial label",
    content: "clean",
    status: 0,
    filename: "docs/notalice.md",
  },
  {
    label: "email",
    content: "alice@secret-host.invalid",
    status: 1,
  },
  {
    label: "author",
    content: "Author <person@secret-host.invalid>",
    status: 1,
  },
  {
    label: "SSH",
    content: "ssh ops@secret-host.invalid",
    status: 1,
  },
  {
    label: "git remote",
    content: "git@secret-host.invalid:o/r.git",
    status: 1,
  },
  {
    label: "bare port",
    content: "secret-host.invalid:8123",
    status: 1,
  },
  {
    label: "bare path",
    content: "secret-host.invalid/health",
    status: 1,
  },
  {
    label: "port and path",
    content: "curl secret-host.invalid:8123/health",
    status: 1,
  },
  {
    label: "wildcard",
    content: "*.secret-host.invalid",
    status: 1,
  },
  {
    label: "corporate wildcard",
    content: "*.corp.net",
    status: 1,
  },
  {
    label: "NO_PROXY",
    content: "NO_PROXY=.secret-host.invalid",
    status: 1,
  },
  {
    label: "mount colon",
    content: "-v /home/alice:/data",
    status: 1,
  },
  {
    label: "file URL",
    content: "file:///Users/alice/x",
    status: 1,
  },
  {
    label: "Windows file URL",
    content: "file:///C:/Users/alice/x",
    status: 1,
  },
  {
    label: "URL comma",
    content: "https://secret-host.invalid,",
    status: 1,
  },
  {
    label: "bold Markdown",
    content: "**secret-host.invalid**",
    status: 1,
  },
  {
    label: "boundary prefix",
    content: "notsecret-host.invalid",
    status: 0,
  },
  {
    label: "hyphen prefix",
    content: "my-secret-host.invalid",
    status: 0,
  },
  {
    label: "longer prose",
    content: "alicebeth malice",
    status: 0,
  },
  {
    label: "public GitHub URL",
    content: "https://github.com/alice/repo",
    status: 0,
  },
  {
    label: "options property",
    content: "options.local = true",
    status: 0,
  },
  {
    label: "bare configured name",
    content: "alice",
    status: 1,
  },
  {
    label: "URL path name",
    content: "https://api.github.com/users/alice",
    status: 1,
  },
  {
    label: "URL user info",
    content: "https://alice.example@github.com/repo",
    status: 1,
  },
  {
    label: "URL query name",
    content: "https://github.com?next=alice.example",
    status: 1,
  },
  {
    label: "URL fragment name",
    content: "https://github.com#alice.example",
    status: 1,
  },
  {
    label: "URL host in path",
    content: "https://github.com/secret-host.invalid",
    status: 1,
  },
  {
    label: "dotted continuation",
    content: "secret-host.invalid.conf",
    status: 1,
  },
  {
    label: "nested name",
    content: "folder/~alice/file",
    status: 1,
  },
  {
    label: "unconfigured local URL",
    content: "https://env.local/",
    status: 0,
  },
  {
    label: "unconfigured host",
    content: "printer.local",
    status: 0,
  },
  {
    label: "configured env-like token",
    content: "env.local.secret-host.invalid",
    status: 1,
  },
  {
    label: "leading dot env token",
    content: ".env.local.secret-host.invalid",
    status: 1,
  },
  {
    label: "allowed then denied",
    content: "https://github.com/alice/repo then alice",
    status: 1,
  },
  {
    label: "copyright email suffix",
    content: "Copyright (c) 2026 alice@private.invalid",
    deny: "alice",
    status: 1,
  },
  {
    label: "GitHub dotted suffix",
    content: "https://github.com/alice.secret-host.invalid/repo",
    deny: "alice",
    status: 1,
  },
  {
    label: "copyright hyphen suffix",
    content: "Copyright (c) 2026 alice-internal",
    deny: "alice",
    status: 1,
  },
  {
    label: "SSH GitHub remote",
    content: "git@github.com:alice/repo.git",
    status: 0,
  },
];
