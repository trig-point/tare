import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ApiError, liveRefresh } from "./api.ts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  Input,
} from "./shared/ui/index.ts";
import { scheduledWorkoutKey } from "./today-api.ts";
import {
  DEFAULT_REST_SECONDS,
  finishGuide,
  type GuideDraft,
  guidePlan,
  MAX_GUIDE_SETS,
  markSet,
  newGuideDraft,
  opensShort,
  type PlannedMovement,
  prescribedSet,
  readGuideDraft,
  readScheduledWorkout,
  restoreGuide,
  restSeconds,
  type ScheduledWorkout,
  writeGuideDraft,
} from "./workout-guide.ts";

export function WorkoutGuideEntry({
  person,
  day,
  online,
  refresh,
}: {
  person: number;
  day: string;
  online: boolean;
  refresh: () => Promise<unknown>;
}) {
  const workout = useQuery({
    ...liveRefresh,
    queryKey: [...scheduledWorkoutKey(person), day],
    queryFn: ({ signal }) => readScheduledWorkout(signal),
    enabled: online,
  });
  const today = workout.data;
  return (
    <WorkoutGuide
      key={person}
      today={today?.day === day && today.kind !== "rest" ? today : null}
      loadFailed={workout.isError && workout.data === undefined}
      storageKey={`tare:workout:${person}`}
      online={online}
      refresh={refresh}
    />
  );
}

function WorkoutGuide({
  today,
  loadFailed,
  storageKey,
  online,
  refresh,
}: {
  today: ScheduledWorkout | null;
  loadFailed: boolean;
  storageKey: string;
  online: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [active, setActive] = useState<ScheduledWorkout | null>(null);
  const [draft, setDraft] = useState(() => readGuideDraft(storageKey));
  const pending = draft.submission;
  const retry = pending && { ...pending, session: null, movements: [] };
  const workout = active ?? retry ?? today;
  if (!workout)
    return loadFailed ? (
      <output className="body-note">Couldn’t load workout</output>
    ) : null;
  return (
    <div className="guide-tile">
      <strong>{workout.name}</strong>
      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null);
            return;
          }
          setDraft(restoreGuide(draft, workout));
          setActive(workout);
        }}
      >
        <DialogTrigger asChild>
          <Button>{pending ? "Resume" : "Start"}</Button>
        </DialogTrigger>
        {active && (
          <GuideSession
            today={active}
            draft={draft}
            setDraft={setDraft}
            storageKey={storageKey}
            online={online}
            onClose={() => setActive(null)}
            refresh={refresh}
          />
        )}
      </Dialog>
    </div>
  );
}

function GuideSession({
  today,
  draft,
  setDraft,
  storageKey,
  online,
  onClose,
  refresh,
}: {
  today: ScheduledWorkout;
  storageKey: string;
  online: boolean;
  draft: GuideDraft;
  setDraft: (draft: GuideDraft) => void;
  onClose: () => void;
  refresh: () => Promise<unknown>;
}) {
  const plan = guidePlan(today);
  const [stored, setStored] = useState(true);
  const save = (next: GuideDraft) => {
    setDraft(next);
    setStored(writeGuideDraft(storageKey, next));
  };
  function clear() {
    writeGuideDraft(storageKey, null);
    setDraft({ ...newGuideDraft(), plan });
    onClose();
  }
  const finish = useMutation({
    networkMode: "always",
    mutationFn: (submitted: GuideDraft) => finishGuide(today, submitted),
    onError: (error, submittedDraft) => {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        today.movements.length > 0
      )
        save({ ...submittedDraft, submission: undefined });
    },
    onSuccess: () => {
      clear();
      void refresh();
    },
  });
  const busy = finish.isPending;
  const submitted = draft.submission;
  const atLimit = Object.keys(draft.marks).length >= MAX_GUIDE_SETS;
  function submit() {
    if (!online || !navigator.onLine || busy) return;
    const { day, kind, name } = today;
    const next = { ...draft, submission: submitted ?? { day, kind, name } };
    save(next);
    finish.mutate(next);
  }
  function undo(set: string) {
    const marks = { ...draft.marks };
    delete marks[set];
    save({
      ...draft,
      marks,
      rest: draft.rest?.set === set ? null : draft.rest,
    });
  }
  return (
    <DialogContent
      className="guide-screen"
      aria-describedby={undefined}
      showCloseButton={false}
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault();
      }}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <header className="body-head">
        <DialogTitle>{today.name}</DialogTitle>
        {draft.rest && !submitted && (
          <RestTimer
            key={`${draft.rest.set}:${draft.rest.end}`}
            end={draft.rest.end}
            onEnd={() => save({ ...draft, rest: null })}
          />
        )}
      </header>
      <div className="guide-movements">
        {!stored && <p className="body-note">Keep this page open</p>}
        {atLimit && !submitted && <p className="body-note">56 sets marked</p>}
        {submitted && <p className="body-note">Finish to retry saving</p>}
        {!submitted &&
          today.movements.map((movement, index) => (
            <Movement key={`${movement.name}:${index}`} movement={movement}>
              {Array.from({ length: movement.sets }, (_, setIndex) => {
                const id = `${String(index).padStart(2, "0")}:${String(setIndex).padStart(2, "0")}`;
                return (
                  <GuideSet
                    key={id}
                    number={setIndex + 1}
                    movement={movement}
                    marked={draft.marks[id]}
                    busy={busy}
                    atLimit={atLimit}
                    done={(row) =>
                      save(markSet(draft, id, row, movement, Date.now))
                    }
                    undo={() => undo(id)}
                  />
                );
              })}
            </Movement>
          ))}
      </div>
      <footer className="guide-actions">
        {finish.isError && <p role="alert">Couldn’t save workout</p>}
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Close
        </Button>
        <Button variant="outline" disabled={busy} onClick={clear}>
          Discard
        </Button>
        <Button
          disabled={
            busy ||
            !online ||
            (!submitted &&
              today.movements.length > 0 &&
              !Object.keys(draft.marks).length)
          }
          onClick={submit}
        >
          {busy ? "Saving…" : "Finish"}
        </Button>
      </footer>
    </DialogContent>
  );
}

function RestTimer({ end, onEnd }: { end: number; onEnd: () => void }) {
  const [remaining, setRemaining] = useState(() => restSeconds(end, Date.now));
  const ended = useRef(false);
  const wasRunning = useRef(remaining > 0);
  useEffect(() => {
    const update = () => {
      const seconds = restSeconds(end, Date.now);
      setRemaining(seconds);
      if (seconds === 0 && !ended.current) {
        ended.current = true;
        if (wasRunning.current && document.visibilityState === "visible")
          navigator.vibrate?.(200);
        onEnd();
      }
    };
    update();
    const interval = window.setInterval(update, 200);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [end, onEnd]);
  return (
    <span className="guide-rest" role="timer">
      Rest {Math.floor(remaining / 60)}:
      {String(remaining % 60).padStart(2, "0")}
    </span>
  );
}

function Movement({
  movement,
  children,
}: {
  movement: PlannedMovement;
  children: ReactNode;
}) {
  const [full, setFull] = useState(() => !opensShort(movement));
  const card = movement.card;
  const rest = card?.rest_seconds ?? DEFAULT_REST_SECONDS;
  return (
    <section className="guide-movement">
      <h3>{movement.name}</h3>
      <p className="body-note">
        {movement.sets} × {movement.reps}
        {movement.load && ` · ${movement.load}`}
      </p>
      {card && (
        <>
          <p className="body-note">
            {card.equipment && `${card.equipment} · `}Rest{" "}
            {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")}
          </p>
          {full && (
            <>
              {(
                [
                  ["Setup", card.setup],
                  ["Cues", card.cues],
                  ["Common mistakes", card.mistakes],
                  ["Safety", card.safety],
                ] as const
              ).map(
                ([label, items]) =>
                  items.length > 0 && (
                    <div key={label}>
                      <h4>{label}</h4>
                      <ul>
                        {Array.from(new Set(items), (item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
              {Array.from(new Set(card.pictures), (url, index) => (
                <img
                  key={url}
                  src={url}
                  alt={`${movement.name} reference ${index + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ))}
            </>
          )}
          <Button
            variant="outline"
            aria-expanded={full}
            onClick={() => setFull(!full)}
          >
            {full ? "Show short card" : "Show full card"}
          </Button>
        </>
      )}
      {children}
    </section>
  );
}

function GuideSet({
  number,
  movement,
  marked,
  busy,
  atLimit,
  done,
  undo,
}: {
  number: number;
  movement: PlannedMovement;
  marked: GuideDraft["marks"][string] | undefined;
  busy: boolean;
  atLimit: boolean;
  done: (row: ReturnType<typeof prescribedSet>) => void;
  undo: () => void;
}) {
  const [row, setRow] = useState(() =>
    marked
      ? {
          ...prescribedSet(movement),
          reps: marked.reps === null ? "" : String(marked.reps),
          load: marked.load === null ? "" : String(marked.load),
          load_unit: marked.load_unit ?? prescribedSet(movement).load_unit,
        }
      : prescribedSet(movement),
  );
  const inputId = useId();
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="guide-set"
      aria-label={`${movement.name} set ${number}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || atLimit || marked) return;
        try {
          done(row);
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
    >
      <span>Set {number}</span>
      <label htmlFor={`${inputId}-reps`}>
        Reps
        <Input
          id={`${inputId}-reps`}
          type="number"
          inputMode="numeric"
          min="0"
          max="1000"
          value={row.reps}
          disabled={busy || !!marked}
          onChange={(event) => setRow({ ...row, reps: event.target.value })}
        />
      </label>
      <label htmlFor={`${inputId}-load`}>
        Load ({row.load_unit})
        <Input
          id={`${inputId}-load`}
          type="number"
          inputMode="decimal"
          min="0"
          max="1000"
          step="any"
          value={row.load}
          disabled={busy || !!marked}
          onChange={(event) => setRow({ ...row, load: event.target.value })}
        />
      </label>
      {marked ? (
        <Button type="button" variant="outline" disabled={busy} onClick={undo}>
          Undo
        </Button>
      ) : (
        <Button type="submit" disabled={busy || atLimit}>
          Done
        </Button>
      )}
      {invalid && <p role="alert">Couldn’t mark set</p>}
    </form>
  );
}
