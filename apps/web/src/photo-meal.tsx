import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageUp, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { ApiError, type Session } from "./api.ts";
import {
  cameraConstraints,
  cameraProblem,
  type ScanProblem,
  scanMessages,
} from "./barcode.ts";
import {
  type Candidate,
  canLog,
  drawJpeg,
  estimatePhoto,
  logMeal,
  photoMessage,
  photoToSend,
  type ReviewPart,
  reviewParts,
  searchCandidates,
} from "./photo-api.ts";
import { Button, cn, Input } from "./shared/ui/index.ts";
import { displayNumber, refreshToday } from "./today-api.ts";

const press =
  "transition-transform duration-(--motion-press) ease-move active:scale-[0.97]";
const hint = "text-sm text-ink-2";
const enter =
  "motion-safe:animate-[screen-enter_var(--motion-tab)_var(--motion-ease-enter)]";

type Props = {
  person: Session["user"];
  online: boolean;
  onLogged: (message: string) => void;
};

export function PhotoMeal({ person, online, onLogged }: Props) {
  const client = useQueryClient();
  const [camera, setCamera] = useState(false);
  const [problem, setProblem] = useState<ScanProblem | null>(null);
  const [parts, setParts] = useState<ReviewPart[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  // Held only until the estimate request starts, so no photo stays in memory.
  const photo = useRef<Blob | null>(null);
  const sent = useRef<{ key: string; id: string } | null>(null);

  const estimate = useMutation({
    retry: 0,
    mutationFn: async () => {
      const image = photo.current;
      photo.current = null;
      if (!image) throw new Error("No photo");
      return estimatePhoto(await photoToSend(image));
    },
    onSuccess: (proposed) => setParts(reviewParts(proposed)),
  });
  const log = useMutation({
    retry: 0,
    mutationFn: () => {
      const key = JSON.stringify(
        parts.map((part) => [part.pick?.fdc_id, part.grams]),
      );
      if (sent.current?.key !== key)
        sent.current = { key, id: crypto.randomUUID() };
      return logMeal(sent.current.id, parts);
    },
    onSuccess: async (count) => {
      sent.current = null;
      setParts([]);
      estimate.reset();
      onLogged(count === 1 ? "Logged 1 food" : `Logged ${count} foods`);
      await refreshToday(client, person.id);
    },
  });

  const send = (image: Blob) => {
    photo.current = image;
    setParts([]);
    log.reset();
    estimate.mutate();
  };

  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia(cameraConstraints);
        const element = video.current;
        if (stopped || !element) return;
        element.srcObject = stream;
        await element.play();
      } catch (error) {
        if (stopped) return;
        setProblem(cameraProblem(error));
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [camera]);

  return (
    <PhotoView
      online={online}
      camera={camera}
      problem={problem}
      estimating={estimate.isPending}
      estimateError={estimate.isError ? photoMessage(estimate.error) : null}
      parts={parts}
      logging={log.isPending}
      logFailed={log.isError}
      video={video}
      openCamera={() => {
        setProblem(null);
        setCamera(true);
      }}
      closeCamera={() => setCamera(false)}
      capture={async () => {
        const element = video.current;
        if (!element?.videoWidth) return;
        const frame = await drawJpeg(
          element,
          element.videoWidth,
          element.videoHeight,
        );
        setCamera(false);
        send(frame);
      }}
      pick={(file) => {
        setCamera(false);
        send(file);
      }}
      change={(key, next) =>
        setParts((current) =>
          current.map((part) =>
            part.key === key ? { ...part, ...next } : part,
          ),
        )
      }
      remove={(key) =>
        setParts((current) => current.filter((part) => part.key !== key))
      }
      submit={() => log.mutate()}
    />
  );
}

export function PhotoView(props: {
  online: boolean;
  camera: boolean;
  problem: ScanProblem | null;
  estimating: boolean;
  estimateError: string | null;
  parts: ReviewPart[];
  logging: boolean;
  logFailed: boolean;
  video?: RefObject<HTMLVideoElement | null>;
  openCamera: () => void;
  closeCamera: () => void;
  capture: () => void;
  pick: (file: File) => void;
  change: (key: string, next: Partial<ReviewPart>) => void;
  remove: (key: string) => void;
  submit: () => void;
}) {
  const busy = !props.online || props.estimating || props.logging;
  return (
    <div className="grid gap-3">
      {!props.online && <p className={cn(hint, "m-0")}>Needs a connection</p>}
      <div className="flex flex-wrap gap-2">
        {props.camera ? (
          <>
            <Button
              type="button"
              className={press}
              disabled={busy}
              onClick={props.capture}
            >
              <Camera aria-hidden="true" />
              Capture
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={press}
              onClick={props.closeCamera}
            >
              Close camera
            </Button>
          </>
        ) : (
          <Button
            type="button"
            className={press}
            disabled={busy}
            onClick={props.openCamera}
          >
            <Camera aria-hidden="true" />
            Take photo
          </Button>
        )}
        <label
          className={cn(
            "inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium pointer-coarse:min-h-[44px] has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
            press,
            busy && "pointer-events-none opacity-50",
          )}
        >
          <ImageUp aria-hidden="true" className="size-4" />
          Choose photo
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) props.pick(file);
            }}
          />
        </label>
      </div>
      <video
        ref={props.video}
        hidden={!props.camera}
        muted
        playsInline
        className="rounded-(--radius) bg-bg-sunk"
      />
      {props.problem && props.problem !== "decoder" && (
        <p role="alert">{scanMessages[props.problem]}</p>
      )}
      {props.estimateError && <p role="alert">{props.estimateError}</p>}
      {props.estimating ? (
        <div aria-hidden="true" className="grid gap-3">
          {[0, 1].map((row) => (
            <div
              key={row}
              className="h-[188px] motion-safe:animate-pulse rounded-(--radius) bg-bg-sunk"
            />
          ))}
        </div>
      ) : (
        props.parts.length > 0 && (
          <form
            aria-label="Meal parts"
            className={cn("grid max-w-none gap-3", enter)}
            onSubmit={(event) => {
              event.preventDefault();
              props.submit();
            }}
          >
            <ul className="m-0 grid list-none gap-3 p-0">
              {props.parts.map((part) => (
                <PartRow
                  key={part.key}
                  part={part}
                  online={props.online}
                  change={(next) => props.change(part.key, next)}
                  remove={() => props.remove(part.key)}
                />
              ))}
            </ul>
            <Button
              type="submit"
              size="lg"
              className={cn(press, "w-full")}
              disabled={busy || !canLog(props.parts)}
            >
              {props.logging ? "Logging..." : "Log meal"}
            </Button>
            {props.logFailed && <p role="alert">Couldn’t log meal</p>}
          </form>
        )
      )}
    </div>
  );
}

function PartRow({
  part,
  online,
  change,
  remove,
}: {
  part: ReviewPart;
  online: boolean;
  change: (next: Partial<ReviewPart>) => void;
  remove: () => void;
}) {
  const candidates = useQuery({
    queryKey: ["food_candidates", part.searchQuery.trim()] as const,
    queryFn: ({ signal }) => searchCandidates(part.searchQuery, signal),
    enabled: online && part.searchQuery.trim() !== "",
    staleTime: 10 * 60_000,
    retry: 0,
  });
  const search = () => {
    const term = part.name.trim();
    if (term && term !== part.searchQuery.trim())
      change({ searchQuery: term, pick: null });
  };
  return (
    <li className="grid gap-3 rounded-(--radius) border border-border bg-surface p-3">
      <div className="flex items-end gap-2">
        <label
          htmlFor={`food-${part.key}`}
          className="grid min-w-0 flex-1 gap-1.5 text-sm font-medium"
        >
          Food
          <Input
            id={`food-${part.key}`}
            value={part.name}
            onChange={(event) => change({ name: event.target.value })}
            onBlur={search}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              search();
            }}
          />
        </label>
        <label
          htmlFor={`grams-${part.key}`}
          className="grid w-24 gap-1.5 text-sm font-medium"
        >
          Grams
          <Input
            id={`grams-${part.key}`}
            type="number"
            min="1"
            step="any"
            inputMode="decimal"
            required
            className="numeric text-center"
            value={part.grams}
            onChange={(event) => change({ grams: event.target.value })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${part.name}`}
          className={press}
          onClick={remove}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className={cn(hint, "m-0")}>
        Estimate{" "}
        <span className="numeric">
          {displayNumber(part.low)} to {displayNumber(part.high)} g
        </span>
      </p>
      <Candidates
        name={part.key}
        pick={part.pick}
        state={
          candidates.data
            ? candidates.data
            : candidates.isError
              ? candidates.error
              : online
                ? "loading"
                : "offline"
        }
        choose={(pick) => change({ pick })}
      />
    </li>
  );
}

function Candidates({
  name,
  pick,
  state,
  choose,
}: {
  name: string;
  pick: Candidate | null;
  state: Candidate[] | Error | "loading" | "offline";
  choose: (pick: Candidate) => void;
}) {
  if (state === "offline") return null;
  if (state === "loading")
    return (
      <div
        aria-hidden="true"
        className="h-[104px] motion-safe:animate-pulse rounded-md bg-bg-sunk"
      />
    );
  if (state instanceof Error)
    return (
      <p role="alert" className="m-0">
        {state instanceof ApiError && state.code === "lookup_unavailable"
          ? "Food search is off"
          : "Couldn’t search foods"}
      </p>
    );
  if (state.length === 0) return <p className={cn(hint, "m-0")}>No matches</p>;
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">Match</legend>
      {state.map((candidate) => (
        <label
          key={candidate.fdc_id}
          className={cn(
            "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-(--motion-press) hover:bg-bg-sunk has-[:checked]:bg-bg-sunk",
            press,
          )}
        >
          <input
            type="radio"
            name={`candidate-${name}`}
            className="m-0 size-4 w-4 shrink-0 accent-accent"
            checked={pick?.fdc_id === candidate.fdc_id}
            onChange={() => choose(candidate)}
          />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <span className="block text-sm">{candidate.name}</span>
            <span className="block text-xs text-ink-2">
              {candidate.brand ?? candidate.data_type}
            </span>
          </span>
          <span className="numeric text-sm text-ink-2">
            {candidate.kcal_per_100g === null
              ? "Unknown"
              : `${displayNumber(candidate.kcal_per_100g)} kcal/100 g`}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
