import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fixture } from "../../../packages/engine/test/auth-support.ts";
import {
  cameraProblem,
  chooseDecoder,
  createDetector,
  type NativeDetector,
  retailCode,
  retailFormats,
  scanMessages,
} from "../src/barcode.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { ScannerPanel } = await import("../src/barcode-scan.tsx");
const dist = new URL("../dist/", import.meta.url);
function nativeReporting(formats: string[]) {
  return class {
    static getSupportedFormats = async () => formats;
    detect = async () => [{ rawValue: "native" }];
  } as unknown as NativeDetector;
}

test("decoder choice follows the reported formats", async () => {
  assert.equal(chooseDecoder([...retailFormats, "qr_code"]), "native");
  assert.equal(chooseDecoder(["ean_13", "upc_a", "ean_8"]), "wasm");
  assert.equal(chooseDecoder([]), "wasm");
  assert.equal(chooseDecoder(null), "wasm");
  const native = await createDetector(
    "/unused.wasm",
    nativeReporting([...retailFormats]),
  );
  assert.equal(native.decoder, "native");
});

// The pnpm pretest script builds dist, so the reader loads the shipped .wasm file.
test("wasm reader loads the engine-served file and decodes a sample EAN-13", async (context) => {
  const wasm = (await readdir(new URL("assets/", dist))).find((name) =>
    /^zxing_reader-.+\.wasm$/.test(name),
  );
  assert.ok(wasm);
  const path = `/assets/${wasm}`;
  assert.ok(
    (await readFile(new URL("sw.js", dist), "utf8")).includes(
      `"assets/${wasm}"`,
    ),
  );
  const options = { webRoot: fileURLToPath(dist), dummyHash: "unused" };
  const { app } = fixture(context, options);
  const served: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string) => {
    const response = await app.request(String(input));
    served.push(
      `${input} ${response.status} ${response.headers.get("Content-Type")}`,
    );
    return response;
  });
  // Node lacks DOMRectReadOnly, which the ponyfill builds for each result.
  class Rect {
    constructor(...edges: number[]) {
      Object.assign(this, {
        x: edges[0],
        y: edges[1],
        width: edges[2],
        height: edges[3],
      });
    }
  }
  Object.assign(globalThis, { DOMRectReadOnly: Rect });
  context.after(() => Reflect.deleteProperty(globalThis, "DOMRectReadOnly"));
  const { decoder, detector } = await createDetector(
    path,
    nativeReporting(["ean_13", "qr_code"]),
  );
  assert.equal(decoder, "wasm");
  await createDetector(path, nativeReporting([]));
  assert.deepEqual(served, [`${path} 200 application/wasm`]);
  const image = await readFile(
    new URL("fixtures/ean13-2001234567893.png", import.meta.url),
  );
  const found = await detector.detect(new Blob([image], { type: "image/png" }));
  assert.equal(retailCode(found), "2001234567893");
});

test("scan problems render their own message with manual entry kept", () => {
  assert.equal(
    cameraProblem(new DOMException("", "NotAllowedError")),
    "denied",
  );
  assert.equal(
    cameraProblem(new DOMException("", "NotFoundError")),
    "no_camera",
  );
  assert.equal(cameraProblem({ name: "OverconstrainedError" }), "constraints");
  assert.equal(cameraProblem(new TypeError("no mediaDevices")), "no_camera");
  const rendered = new Set<string>();
  for (const problem of [
    "denied",
    "no_camera",
    "constraints",
    "decoder",
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(ScannerPanel, {
        code: "",
        online: true,
        scanning: false,
        problem,
        torch: false,
        torchOn: false,
        setCode: () => {},
        start: () => {},
        stop: () => {},
        toggleTorch: () => {},
        submit: () => {},
      }),
    );
    assert.ok(
      html.includes(`<p role="alert">${scanMessages[problem]}</p>`),
      problem,
    );
    assert.ok(html.includes('id="barcode-code"'), problem);
    rendered.add(scanMessages[problem]);
  }
  assert.equal(rendered.size, 4);
});
