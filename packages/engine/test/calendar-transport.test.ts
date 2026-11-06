import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter, getEventListeners, once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  ClientRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer, type RequestOptions, request } from "node:https";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { RequestFilteringHttpsAgent } from "request-filtering-agent";
import { createCalendarTransport } from "../src/calendar/transport.ts";
import { test } from "./support/hang-ceiling.ts";

const state = {
  hits: 0,
  connections: 0,
  answers: ["127.0.0.1"],
  lookupHost: "",
  remoteAddress: "",
  controller: new AbortController(),
  delivered: new EventEmitter(),
};
let respond: (incoming: IncomingMessage, response: ServerResponse) => void = (
  _incoming,
  response,
) => {
  response.end("invented feed");
};
const directory = mkdtempSync(join(tmpdir(), "tare-calendar-"));
const key = join(directory, "key.pem"),
  cert = join(directory, "cert.pem");
execFileSync(
  "openssl",
  [
    ..."req -x509 -newkey rsa:2048 -nodes -days 1".split(" "),
    "-keyout",
    key,
    "-out",
    cert,
    "-subj",
    "/CN=feed.example.test",
    "-addext",
    "subjectAltName=DNS:feed.example.test",
  ],
  { stdio: "ignore" },
);
const ca = readFileSync(cert);
const server = createServer(
  { key: readFileSync(key), cert: ca },
  (incoming, response) => {
    state.hits++;
    respond(incoming, response);
  },
);
server.on("tlsClientError", () => {});
server.on("connection", () => {
  state.connections++;
});
before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
  assert.equal(existsSync(directory), false);
});
const routed = (
  url: string,
  options: RequestOptions,
  callback: (incoming: IncomingMessage) => void,
) => {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const outgoing = request(
    url,
    {
      ...options,
      ca,
      port: address.port,
      lookup(hostname, lookupOptions, done) {
        state.lookupHost = hostname;
        const addresses = state.answers.map((address) => ({
          address,
          family: isIP(address),
        }));
        if (lookupOptions.all) done(null, addresses);
        else {
          const answer = addresses[0];
          assert.ok(answer);
          done(null, answer.address, answer.family);
        }
      },
    },
    (incoming) => {
      incoming.on("data", () => state.delivered.emit("chunk"));
      callback(incoming);
    },
  );
  outgoing.on("socket", (socket) =>
    socket.once("connect", () => {
      state.remoteAddress = socket.remoteAddress as string;
    }),
  );
  return outgoing;
};
const allowed = createCalendarTransport({
  requestFeed: routed as typeof request,
  createAgent: () =>
    new RequestFilteringHttpsAgent({
      keepAlive: false,
      allowIPAddressList: ["127.0.0.1"],
    }),
});
const filtered = createCalendarTransport({
  requestFeed: routed as typeof request,
});
const url = "https://feed.example.test/private-token";
const read = (target = url) => allowed(target, state.controller.signal);
const clean = () =>
  assert.equal(getEventListeners(state.controller.signal, "abort").length, 0);

test("calendar transport refuses 22 address classes, mixed DNS answers and literal hosts before any request", async () => {
  const addresses =
    "127.0.0.1 10.0.0.1 172.16.0.1 192.168.0.1 169.254.1.1 100.64.0.1 224.0.0.1 0.0.0.0 ::1 fe80::1 fd00::1 ff02::1 :: ::ffff:127.0.0.1 ::ffff:10.0.0.1 ::ffff:169.254.1.1 ::ffff:100.64.0.1 ::ffff:224.0.0.1 ::ffff:0.0.0.0 ::ffff:172.16.0.1 ::ffff:192.168.0.1 ::ffff:7f00:1".split(
      " ",
    );
  assert.equal(addresses.length, 22);
  for (const answers of [
    ...addresses.map((address) => [address]),
    ["93.184.216.34", "127.0.0.1"],
  ]) {
    state.answers = answers;
    const body = await filtered(url, state.controller.signal);
    assert.equal(state.hits, 0, answers.join(","));
    assert.equal(state.connections, 0, answers.join(","));
    assert.equal(body, null, answers.join(","));
  }
  for (const host of ["127.0.0.1", "[::1]", "[::ffff:127.0.0.1]"])
    assert.equal(
      await filtered(`https://${host}/private-token`, state.controller.signal),
      null,
    );
  assert.equal(state.connections, 0);
  state.answers = ["127.0.0.1"];
});

test("calendar transport preserves socket and host TLS, refuses redirects, bounds bytes and rejects compression", async () => {
  assert.equal(await read(), "invented feed");
  assert.equal(state.lookupHost, "feed.example.test");
  assert.equal(state.remoteAddress, "127.0.0.1");
  assert.equal(await read("https://wrong.example.test/private-token"), null);
  assert.equal(state.hits, 1);
  for (const statusCode of [302, 404]) {
    respond = (_incoming, response) => {
      response.writeHead(statusCode, {
        Location: "https://feed.example.test/redirect-target",
      });
      response.end();
    };
    const requestsBefore: number = state.hits;
    assert.equal(await read(), null);
    assert.equal(state.hits, requestsBefore + 1);
  }
  for (const length of [1_000_000, 1_000_001])
    for (const contentLength of [false, true]) {
      respond = (incoming, response) => {
        assert.equal(incoming.headers["accept-encoding"], "identity");
        if (contentLength) response.setHeader("Content-Length", length);
        response.write(Buffer.alloc(length, 97));
        response.end();
      };
      assert.equal(
        (await read())?.length ?? null,
        length === 1_000_000 ? length : null,
      );
    }
  respond = (_incoming, response) => {
    response.setHeader("Content-Encoding", "gzip");
    response.end("private title");
  };
  assert.equal(await read(), null);
  clean();
});

test("calendar total deadline stops withheld and trickling responses at 10000ms; abort and errors clean up", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const destroyed = context.mock.method(ClientRequest.prototype, "destroy");
  for (const trickle of [false, true]) {
    let response: ServerResponse | undefined;
    respond = (_incoming, outgoing) => {
      response = outgoing;
      if (trickle) outgoing.flushHeaders();
    };
    const arrived = once(server, "request");
    let settled = false;
    const pending = read().then((body) => {
      settled = true;
      return body;
    });
    await arrived;
    for (let second = 0; second < 9; second++) {
      if (trickle) {
        const chunk = once(state.delivered, "chunk");
        response?.write("a");
        await chunk;
      }
      context.mock.timers.tick(1000);
    }
    context.mock.timers.tick(999);
    assert.equal(settled, false);
    context.mock.timers.tick(1);
    assert.equal(await pending, null);
    clean();
  }
  const arrived = once(server, "request"),
    pending = read();
  await arrived;
  state.controller.abort();
  assert.equal(await pending, null);
  clean();
  assert.equal(await read(), null);
  assert.equal(
    await createCalendarTransport({
      createAgent() {
        throw new Error(url);
      },
    })(url, new AbortController().signal),
    null,
  );
  const count = destroyed.mock.callCount();
  context.mock.timers.tick(100_000);
  assert.equal(destroyed.mock.callCount(), count);
});
