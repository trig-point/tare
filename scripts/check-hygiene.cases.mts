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
    label: "API path",
    content: "https://api.github.com/users/alice",
    status: 0,
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
    label: "bare name",
    content: "alice",
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
    label: "env URL",
    content: `https://${["env", "local"].join(".")}/`,
    status: 1,
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
    label: "non suffix",
    content: "secret-host.invalid.conf",
    status: 0,
  },
  {
    label: "userinfo",
    content: "https://alice.example@github.com:443/repo",
    status: 0,
  },
  {
    label: "query",
    content: "https://github.com?next=alice.example",
    status: 0,
  },
  {
    label: "fragment",
    content: "https://github.com#alice.example",
    status: 0,
  },
  {
    label: "URL path host",
    content: "https://github.com/secret-host.invalid",
    status: 0,
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
    label: "nested tilde",
    content: "folder/~alice/file",
    status: 0,
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
    label: "generic host",
    content: ["printer", "local"].join("."),
    status: 1,
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
];
