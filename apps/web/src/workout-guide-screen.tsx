import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { liveRefresh } from "./api.ts";
import { setInput, setRow } from "./health-api.ts";
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
  closeStaleGuide,
  DEFAULT_REST_SECONDS,
  discardGuide,
  guideClientId,
  newGuideSet,
  opensShort,
  type PlannedMovement,
  prescribedSet,
  readGuideActivity,
  readScheduledWorkout,
  restEnd,
  restSeconds,
  type SavedWorkout,
  type ScheduledWorkout,
  saveGuideSet,
  undoGuideSet,
} from "./workout-guide.ts";

export function WorkoutGuideEntry({
  person,
  day,
  online,
  refresh,
}: {
  person: number;
  day: string | undefined;
  online: boolean;
  refresh: () => Promise<unknown>;
}) {
  const schedule = useQuery({
    ...liveRefresh,
    queryKey: [...scheduledWorkoutKey(person), day],
    queryFn: ({ signal }) => readScheduledWorkout(signal),
    enabled: online && day !== undefined,
  });
  const [active, setActive] = useState<ScheduledWorkout | null>(null);
  const today = schedule.data;
  const workout =
    active ??
    (today && today.day === day && today.movements.length ? today : null);
  if (!workout)
    return schedule.isError ? (
      <output className="body-note">Couldn’t load workout</output>
    ) : null;
  return (
    <div className="guide-tile">
      <strong>{workout.name}</strong>
      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (open) setActive(workout);
        }}
      >
        <DialogTrigger asChild>
          <Button>Start</Button>
        </DialogTrigger>
        {active && (
          <GuideSession
            person={person}
            workout={active}
            online={online}
            refresh={refresh}
            close={() => setActive(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function GuideSession({
  person,
  workout,
  online,
  refresh,
  close,
}: {
  person: number;
  workout: ScheduledWorkout;
  online: boolean;
  refresh: () => Promise<unknown>;
  close: () => void;
}) {
  const client = useQueryClient();
  const id = guideClientId(workout);
  const queryKey = ["guide-activity", person, id] as const;
  const activity = useQuery({
    queryKey,
    queryFn: ({ signal }) => readGuideActivity(workout, signal),
    enabled: online,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
  });
  const { refetch } = activity;
  const [rest, setRest] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<SavedWorkout | null>(null);
  type Action = { row: string; activity: SavedWorkout | null } & (
    | {
        kind: "done";
        change: ReturnType<typeof newGuideSet>;
        movement: PlannedMovement;
      }
    | { kind: "undo"; id: string }
  );
  const [failed, setFailed] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const settle = () => {
    client.setQueryData(queryKey, null);
    close();
    void refresh();
  };
  const scope = { id: JSON.stringify(queryKey) };
  const save = useMutation({
    scope,
    networkMode: "always",
    mutationFn: async (action: Action) => {
      await client.cancelQueries({ queryKey });
      if (action.kind === "done")
        return saveGuideSet(workout, action.activity, action.change);
      if (!action.activity) throw new Error("Missing saved workout");
      return {
        activity: await undoGuideSet(workout, action.activity, action.id),
        saved: true,
      };
    },
    onSuccess: (result, action) => {
      client.setQueryData(queryKey, result.activity);
      setFailed(null);
      setMessage(result.saved ? null : "Not saved");
      setRest(
        result.saved && action.kind === "done"
          ? restEnd(action.movement, Date.now)
          : null,
      );
    },
    onError: (error, action) => {
      if (!closeStaleGuide(error, settle)) setFailed(action);
    },
  });
  const discard = useMutation({
    scope,
    networkMode: "always",
    mutationFn: async (confirmed: SavedWorkout | null) => {
      await client.cancelQueries({ queryKey });
      if (confirmed) {
        await discardGuide(workout, confirmed);
        return null;
      }
      return readGuideActivity(workout);
    },
    onSuccess: (current) => {
      if (!current) settle();
      else {
        client.setQueryData(queryKey, current);
        setConfirm(current);
      }
    },
  });
  const busy = save.isPending || discard.isPending;
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible" && !busy && online)
        void refetch();
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [busy, online, refetch]);
  const saved = activity.data;
  const blocked = busy || activity.isFetching || saved === undefined;
  const occurrences = new Map<string, number>();
  return (
    <DialogContent
      className="guide-screen"
      aria-describedby={undefined}
      showCloseButton={false}
    >
      <header className="body-head">
        <DialogTitle>{workout.name}</DialogTitle>
        {rest !== null && (
          <RestTimer key={rest} end={rest} onEnd={() => setRest(null)} />
        )}
      </header>
      <div className="guide-movements">
        {saved === undefined && activity.isError && (
          <Button variant="outline" onClick={() => void refetch()}>
            Retry loading workout
          </Button>
        )}
        {!online && <p className="body-note">Offline</p>}
        {message && <p role="alert">{message}</p>}
        {workout.movements.map((movement) => {
          const exercise = prescribedSet(movement).exercise;
          const offset = occurrences.get(exercise) ?? 0;
          occurrences.set(exercise, offset + movement.sets);
          const sets = saved?.sets.filter(
            (set) => set.client_set_id && set.exercise === exercise,
          );
          return (
            <Movement
              key={JSON.stringify([exercise, offset])}
              movement={movement}
            >
              {Array.from({ length: movement.sets }, (_, setIndex) => {
                const row = JSON.stringify([exercise, offset + setIndex]);
                const marked = sets?.[offset + setIndex];
                return (
                  <GuideSet
                    key={row}
                    number={setIndex + 1}
                    movement={movement}
                    marked={marked}
                    busy={blocked || (failed !== null && failed.row !== row)}
                    failed={failed?.row === row}
                    retry={() => {
                      if (failed) save.mutate(failed);
                    }}
                    done={(input) =>
                      save.mutate({
                        kind: "done",
                        row,
                        activity: saved ?? null,
                        change: newGuideSet(setInput(input)),
                        movement,
                      })
                    }
                    undo={() => {
                      if (saved && marked?.client_set_id)
                        save.mutate({
                          kind: "undo",
                          row,
                          activity: saved,
                          id: marked.client_set_id,
                        });
                    }}
                  />
                );
              })}
            </Movement>
          );
        })}
      </div>
      <footer className="guide-actions">
        {discard.isError && <p role="alert">Couldn’t discard workout</p>}
        {confirm !== null ? (
          <>
            <p className="body-note">Delete saved workout?</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                discard.reset();
                setConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={blocked || !online || !saved}
              onClick={() => {
                discard.mutate(confirm);
              }}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => {
                if (saved || failed) discard.mutate(null);
                else close();
              }}
            >
              Discard
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                close();
                void refresh();
              }}
            >
              Finish
            </Button>
          </>
        )}
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
  failed,
  retry,
  done,
  undo,
}: {
  number: number;
  movement: PlannedMovement;
  marked: SavedWorkout["sets"][number] | undefined;
  busy: boolean;
  failed: boolean;
  retry: () => void;
  done: (row: ReturnType<typeof prescribedSet>) => void;
  undo: () => void;
}) {
  const [input, setInput] = useState(() => prescribedSet(movement));
  const row = marked ? setRow(marked) : input;
  const inputId = useId();
  return (
    <form
      className="guide-set"
      aria-label={`${movement.name} set ${number}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !marked && !failed) done(row);
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
          disabled={busy || !!marked || failed}
          onChange={(event) => setInput({ ...row, reps: event.target.value })}
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
          disabled={busy || !!marked || failed}
          onChange={(event) => setInput({ ...row, load: event.target.value })}
        />
      </label>
      {failed ? (
        <Button type="button" disabled={busy} onClick={retry}>
          Retry
        </Button>
      ) : marked ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            undo();
          }}
        >
          Undo
        </Button>
      ) : (
        <Button type="submit" disabled={busy}>
          Done
        </Button>
      )}
      {failed && <p role="alert">Not saved</p>}
    </form>
  );
}
