import type { ClientRequest, IncomingMessage } from "node:http";
import { type Agent, request } from "node:https";
import { RequestFilteringHttpsAgent } from "request-filtering-agent";
export type CalendarTransport = (
  url: string,
  signal: AbortSignal,
) => Promise<string | null>;

export function validFeedUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.href.includes("#") &&
      !url.port
    );
  } catch {
    return false;
  }
}

export function createCalendarTransport({
  createAgent = () => new RequestFilteringHttpsAgent({ keepAlive: false }),
  requestFeed = request,
}: {
  createAgent?: () => Agent;
  requestFeed?: typeof request;
} = {}): CalendarTransport {
  return async (url, signal) => {
    if (signal.aborted || !validFeedUrl(url)) return null;
    return new Promise<string | null>((resolve) => {
      let agent: Agent;
      try {
        agent = createAgent();
      } catch {
        resolve(null);
        return;
      }
      let outgoing: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      let body: string | null = null;
      const chunks: Buffer[] = [];
      let bytes = 0;
      let failed = false;
      const timer = setTimeout(fail, 10_000);
      function fail() {
        failed = true;
        body = null;
        response?.destroy();
        outgoing?.destroy();
      }
      function finish() {
        clearTimeout(timer);
        signal.removeEventListener("abort", fail);
        outgoing?.removeListener("error", fail);
        response?.removeAllListeners("data");
        response?.removeAllListeners("end");
        response?.removeAllListeners("aborted");
        response?.removeAllListeners("error");
        agent.destroy();
        resolve(body);
      }
      signal.addEventListener("abort", fail, { once: true });
      try {
        outgoing = requestFeed(
          url,
          { agent, headers: { "Accept-Encoding": "identity" } },
          (incoming) => {
            response = incoming;
            if (
              incoming.statusCode !== 200 ||
              (incoming.headers["content-encoding"] &&
                incoming.headers["content-encoding"] !== "identity")
            ) {
              fail();
              return;
            }
            incoming.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 1_000_000) fail();
              else chunks.push(chunk);
            });
            incoming.once("end", () => {
              if (!failed) body = Buffer.concat(chunks).toString("utf8");
            });
            incoming.once("error", fail);
            incoming.once("aborted", fail);
          },
        );
        outgoing.once("error", fail);
        outgoing.once("close", finish);
        outgoing.end();
      } catch {
        fail();
        finish();
      }
    });
  };
}
