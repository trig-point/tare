export const retailFormats = ["ean_13", "upc_a", "ean_8", "upc_e"] as const;

export type Decoder = "native" | "wasm";
export type ScanProblem = "denied" | "no_camera" | "constraints" | "decoder";
type Detector = {
  detect(source: HTMLVideoElement | Blob): Promise<{ rawValue: string }[]>;
};
export type NativeDetector = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<readonly string[]>;
};

export const cameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function chooseDecoder(supported: readonly string[] | null): Decoder {
  return supported !== null &&
    retailFormats.every((format) => supported.includes(format))
    ? "native"
    : "wasm";
}

export async function createDetector(
  wasmUrl: string,
  native: NativeDetector | undefined = (
    globalThis as { BarcodeDetector?: NativeDetector }
  ).BarcodeDetector,
): Promise<{ decoder: Decoder; detector: Detector }> {
  const supported = native
    ? await native.getSupportedFormats().catch(() => null)
    : null;
  if (native && chooseDecoder(supported) === "native")
    return {
      decoder: "native",
      detector: new native({ formats: [...retailFormats] }),
    };
  const ponyfill = await import("barcode-detector/ponyfill");
  // Loading eagerly turns a missing .wasm file into a start failure, not a silent scan miss.
  await ponyfill.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  });
  return {
    decoder: "wasm",
    detector: new ponyfill.BarcodeDetector({ formats: [...retailFormats] }),
  };
}

export function retailCode(found: { rawValue: string }[]) {
  return found.map((barcode) => barcode.rawValue).find(isBarcode) ?? null;
}

export function isBarcode(text: string) {
  return /^\d{8,14}$/.test(text);
}

export function cameraProblem(error: unknown): ScanProblem {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? error.name
      : null;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "OverconstrainedError") return "constraints";
  return "no_camera";
}

export const scanMessages: Record<ScanProblem, string> = {
  denied: "Camera access denied",
  no_camera: "No camera available",
  constraints: "Camera settings not supported",
  decoder: "Barcode reader failed",
};

export function hasTorch(track: MediaStreamTrack) {
  const capabilities = track.getCapabilities?.() as
    | { torch?: boolean }
    | undefined;
  return capabilities?.torch === true;
}
