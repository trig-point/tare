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
    <div className="scanner">
      {props.scanning ? (
        <button type="button" onClick={props.stop}>
          Stop scanning
        </button>
      ) : (
        <button type="button" onClick={props.start}>
          Scan barcode
        </button>
      )}
      {props.scanning && props.torch && (
        <button type="button" onClick={props.toggleTorch}>
          {props.torchOn ? "Torch off" : "Torch on"}
        </button>
      )}
      <video ref={props.video} hidden={!props.scanning} muted playsInline />
      {props.problem && <p role="alert">{scanMessages[props.problem]}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.submit();
        }}
      >
        <label htmlFor="barcode-code">Barcode</label>
        <input
          id="barcode-code"
          inputMode="numeric"
          autoComplete="off"
          value={props.code}
          onChange={(event) => props.setCode(event.target.value)}
        />
        <button
          type="submit"
          disabled={!props.online || !isBarcode(props.code.trim())}
        >
          Look up
        </button>
        {!props.online && <p>Lookup unavailable offline</p>}
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
