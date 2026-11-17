import { ScanBarcode } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import {
  cameraConstraints,
  cameraProblem,
  createDetector,
  hasTorch,
  isBarcode,
  retailCode,
  type ScanProblem,
  scanMessages,
} from "./barcode.ts";
import { Button, Input } from "./shared/ui/index.ts";

const press =
  "transition-transform duration-(--motion-press) ease-move active:scale-[0.97]";

type Props = { online: boolean; onCode: (code: string) => void };

export function BarcodeScanner({ online, onCode }: Props) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<ScanProblem | null>(null);
  const [torch, setTorch] = useState<MediaStreamTrack | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef(onCode);
  latest.current = onCode;
  const onlineNow = useRef(online);
  onlineNow.current = online;

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    const finish = (found: ScanProblem | null) => {
      if (stopped) return;
      setProblem(found);
      setScanning(false);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
      } catch (error) {
        finish(cameraProblem(error));
        return;
      }
      const element = video.current;
      if (stopped || !element) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const track = stream.getVideoTracks()[0];
      setTorch(track && hasTorch(track) ? track : null);
      try {
        element.srcObject = stream;
        await element.play();
        const { detector } = await createDetector(wasmUrl);
        while (!stopped) {
          await nextFrame(element);
          if (stopped) return;
          const found = retailCode(await detector.detect(element));
          if (stopped) return;
          if (found) {
            setCode(found);
            finish(null);
            if (onlineNow.current) latest.current(found);
            return;
          }
        }
      } catch {
        finish("decoder");
      }
    })();
    return () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
      setTorch(null);
      setTorchOn(false);
    };
  }, [scanning]);

  return (
    <ScannerPanel
      code={code}
      online={online}
      scanning={scanning}
      problem={problem}
      torch={torch !== null}
      torchOn={torchOn}
      video={video}
      setCode={setCode}
      start={() => {
        setProblem(null);
        setScanning(true);
      }}
      stop={() => setScanning(false)}
      toggleTorch={() => {
        const next = !torchOn;
        torch
          ?.applyConstraints({
            advanced: [{ torch: next } as MediaTrackConstraintSet],
          })
          .then(
            () => setTorchOn(next),
            () => setTorch(null),
          );
      }}
      submit={() => onCode(code.trim())}
    />
  );
}

export function ScannerPanel(props: {
  code: string;
  online: boolean;
  scanning: boolean;
  problem: ScanProblem | null;
  torch: boolean;
  torchOn: boolean;
  video?: RefObject<HTMLVideoElement | null>;
  setCode: (code: string) => void;
  start: () => void;
  stop: () => void;
  toggleTorch: () => void;
  submit: () => void;
}) {
  return (
    <div className="scanner grid gap-3">
      <div className="flex flex-wrap gap-2">
        {props.scanning ? (
          <Button
            type="button"
            variant="secondary"
            className={press}
            onClick={props.stop}
          >
            Stop scanning
          </Button>
        ) : (
          <Button type="button" className={press} onClick={props.start}>
            <ScanBarcode aria-hidden="true" />
            Scan barcode
          </Button>
        )}
        {props.scanning && props.torch && (
          <Button
            type="button"
            variant="outline"
            className={press}
            onClick={props.toggleTorch}
          >
            {props.torchOn ? "Torch off" : "Torch on"}
          </Button>
        )}
      </div>
      <video
        ref={props.video}
        hidden={!props.scanning}
        muted
        playsInline
        className="rounded-(--radius) bg-bg-sunk"
      />
      {props.problem && <p role="alert">{scanMessages[props.problem]}</p>}
      <form
        className="grid max-w-none gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          props.submit();
        }}
      >
        <label htmlFor="barcode-code" className="text-sm font-medium">
          Barcode number
        </label>
        <div className="flex gap-2">
          <Input
            id="barcode-code"
            inputMode="numeric"
            autoComplete="off"
            className="numeric"
            value={props.code}
            onChange={(event) => props.setCode(event.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            className={press}
            disabled={!props.online || !isBarcode(props.code.trim())}
          >
            Look up
          </Button>
        </div>
        {!props.online && (
          <p className="m-0 text-sm text-ink-2">Lookup unavailable offline</p>
        )}
      </form>
    </div>
  );
}

function nextFrame(element: HTMLVideoElement) {
  return new Promise<void>((resolve) => {
    if ("requestVideoFrameCallback" in element)
      element.requestVideoFrameCallback(() => resolve());
    else requestAnimationFrame(() => resolve());
  });
}
