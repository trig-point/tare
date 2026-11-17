import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  blankSet,
  bodyRows,
  canConnectOura,
  connectOura,
  deleteActivity,
  deleteHabit,
  type Habit,
  habitLabels,
  logActivity,
  loggedSource,
  logHabit,
  metricLabels,
  onPageRestored,
  ouraKey,
  ouraView,
  readOura,
  replaceSets,
  type SetInput,
  type SetRow,
  setInput,
  setRow,
  setText,
  signalsQuery,
  signalText,
  sourceLabel,
  type Workout,
  withClientId,
} from "./health-api.ts";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Input,
} from "./shared/ui/index.ts";
import { press } from "./slots.tsx";
import { displayNumber, refreshToday } from "./today-api.ts";
import "./health.css";

export function BodyCard({
  person,
  day,
  timezone = "UTC",
  online,
}: {
  person: number;
  day: string;
  timezone?: string;
  online: boolean;
}) {
  const client = useQueryClient();
  const signals = useQuery({ ...signalsQuery(person, day), enabled: online });
  const connection = useQuery({
    queryKey: ouraKey(person),
    queryFn: ({ signal }) => readOura(signal),
    enabled: online,
  });
  if (signals.isError) return <p role="alert">Couldn’t load signals</p>;
  if (!signals.data) return online ? <BodySkeleton /> : null;
  const rows = bodyRows(signals.data.signals);
  const { activities, habits } = signals.data;
  const view = connection.data && ouraView(connection.data);
  const canConnect = view !== undefined && canConnectOura(view);
  const synced = view?.state === "connected" ? view.lastSynced : null;
  const entry = { online, refresh: () => refreshToday(client, person) };
  return (
    <section className="body-tab" aria-label="Body">
      <section className="body-section" aria-labelledby="body-signals">
        <div className="body-head">
          <h2 id="body-signals">Signals</h2>
          {synced && (
            <span className="body-note">
              Synced{" "}
              <time dateTime={synced}>
                {new Date(synced).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: timezone,
                })}
              </time>
            </span>
          )}
        </div>
        {rows.length === 0 &&
          (activities.length === 0 && habits.length === 0 ? (
            <p className="body-note">Nothing logged</p>
          ) : (
            <p className="body-note">No signals today</p>
          ))}
        {rows.length === 0 && canConnect && (
          <p>
            <a href="/settings">Connect a source in Settings</a>
          </p>
        )}
        {rows.length > 0 && (
          <dl className="signal-tiles">
            {rows.map((row) => (
              <div key={`${row.metric}-${row.source}`} className="signal-tile">
                <dt>{metricLabels[row.metric]}</dt>
                <dd>{signalText(row)}</dd>
                <dd className="source">{sourceLabel(row.source)}</dd>
                {row.why.map((line) => (
                  <dd key={line} className="why">
                    {line}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        )}
      </section>
      <div className="body-column">
        <Recovery {...entry} />
        <section className="body-section" aria-labelledby="body-workouts">
          <div className="body-head">
            <h2 id="body-workouts">Workouts</h2>
            <LogWorkout day={day} {...entry} />
          </div>
          {activities.length === 0 ? (
            <p className="body-note">No workouts today</p>
          ) : (
            <ul className="body-list" aria-label="Workouts">
              {activities.map((workout) => (
                <WorkoutEntry
                  key={workout.id}
                  workout={workout}
                  timezone={timezone}
                  {...entry}
                />
              ))}
            </ul>
          )}
        </section>
        <section className="body-section" aria-labelledby="body-habits">
          <div className="body-head">
            <h2 id="body-habits">Habits</h2>
            <LogHabit day={day} {...entry} />
          </div>
          {habits.length === 0 ? (
            <p className="body-note">No habits today</p>
          ) : (
            <ul className="body-list" aria-label="Habits">
              {habits.map((habit) => (
                <HabitEntry
                  key={habit.habit_key}
                  habit={habit}
                  day={day}
                  {...entry}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

const skeletonTiles = ["first", "second", "third", "fourth"];
const skeletonSections = ["Workouts", "Habits"];
const pulse =
  "inline-block animate-pulse rounded-sm bg-bg-sunk motion-reduce:animate-none";
/** Placeholder tiles and sections laid out like the real ones, so the tab does not jump when signals arrive. */
function BodySkeleton() {
  return (
    <div className="body-tab" aria-busy="true">
      <div className="body-section">
        <div className="body-head">
          <h2>Signals</h2>
        </div>
        <dl className="signal-tiles">
          {skeletonTiles.map((name) => (
            <div key={name} className="signal-tile">
              <dt>
                <span className={cn(pulse, "h-[1em] w-20 align-middle")} />
              </dt>
              <dd>
                <span className={cn(pulse, "h-[1em] w-16 align-middle")} />
              </dd>
              <dd className="source">
                <span className={cn(pulse, "h-[1em] w-10 align-middle")} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="body-column">
        <div className="body-section">
          <div className="body-head">
            <h2>Recovery</h2>
          </div>
          <div className="body-quick">
            <span className={cn(pulse, "h-10 pointer-coarse:h-11")} />
            <span className={cn(pulse, "h-10 pointer-coarse:h-11")} />
          </div>
        </div>
        {skeletonSections.map((name) => (
          <div key={name} className="body-section">
            <div className="body-head">
              <h2>{name}</h2>
            </div>
            <span className={cn(pulse, "h-[1em] w-28")} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  // Controlled sheets have no Radix trigger, so focus goes back to the opener by hand.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
        className="body-sheet top-auto bottom-0 left-1/2 w-full max-w-[40rem] translate-y-0 -translate-x-1/2 gap-0 rounded-b-none rounded-t-xl border-x-0 border-b-0 bg-card p-0 sm:max-w-[40rem] sm:border-x"
      >
        <div className="body-sheet-head">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              className={press}
            >
              <XIcon />
            </Button>
          </DialogClose>
        </div>
        <div className="body-sheet-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

type EntryProps = { online: boolean; refresh: () => Promise<void> };
function useEntryMutation<Input>(
  { online, refresh }: EntryProps,
  run: (input: Input) => Promise<unknown>,
  done?: () => void,
) {
  return useMutation({
    networkMode: "always",
    mutationFn: async (input: Input) => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await run(input);
    },
    onSuccess: async () => {
      done?.();
      await refresh();
    },
  });
}

function WorkoutEntry({
  workout,
  timezone,
  ...entry
}: EntryProps & { workout: Workout; timezone: string }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<SetRow[]>([]);
  const [addToTracker] = useState(() => withClientId(logActivity));
  const logged = loggedSource(workout.source);
  const save = useEntryMutation(
    entry,
    (sets: SetInput[]) =>
      logged
        ? replaceSets(workout.id, sets)
        : addToTracker({
            kind: workout.kind,
            started_at: workout.started_at,
            duration_minutes: workout.duration_minutes,
            sets,
          }),
    () => setEditing(false),
  );
  const remove = useEntryMutation(entry, () => deleteActivity(workout.id));
  const busy = !entry.online || save.isPending || remove.isPending;
  const details = [
    workout.started_at === null
      ? "Time not recorded"
      : new Date(workout.started_at).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          timeZone: timezone,
        }),
    workout.duration_minutes !== null && `${workout.duration_minutes} min`,
    workout.calories !== null && `${displayNumber(workout.calories)} kcal`,
    [workout.source, workout.tracker?.source]
      .flatMap((source) => (source ? sourceLabel(source) : []))
      .join(" + "),
  ];
  const editLabel = logged ? "Edit sets" : "Add sets";
  return (
    <li className="body-row">
      <div className="body-row-text">
        <strong>{workout.kind}</strong>
        <span>{details.filter(Boolean).join(" · ")}</span>
        {workout.notes && <span>{workout.notes}</span>}
        {workout.sets.length > 0 && (
          <ol aria-label={`${workout.kind} sets`}>
            {workout.sets.map((set) => (
              <li key={set.set_index}>{setText(set)}</li>
            ))}
          </ol>
        )}
      </div>
      <div className="body-row-actions">
        {(logged || workout.category !== "other") && (
          <Button
            variant="ghost"
            size="sm"
            className={press}
            disabled={busy}
            onClick={() => {
              setRows(
                workout.sets.length > 0
                  ? workout.sets.map(setRow)
                  : [blankSet()],
              );
              save.reset();
              setEditing(true);
            }}
          >
            {editLabel}
          </Button>
        )}
        {logged && (
          <DeleteButton
            label={workout.kind}
            disabled={busy}
            remove={() => remove.mutate(undefined)}
          />
        )}
      </div>
      {remove.isError && <p role="alert">Couldn’t delete workout</p>}
      <Sheet
        open={editing}
        onOpenChange={setEditing}
        title={`${editLabel}: ${workout.kind}`}
      >
        <form
          className="body-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(rows.map(setInput));
          }}
        >
          <SetFields rows={rows} setRows={setRows} disabled={busy} />
          {save.isError && <p role="alert">Couldn’t update workout</p>}
          <SubmitButton disabled={busy}>Save sets</SubmitButton>
        </form>
      </Sheet>
    </li>
  );
}

function HabitEntry({
  habit,
  day,
  ...entry
}: EntryProps & { habit: Habit; day: string }) {
  const label = habitLabels[habit.habit_key] ?? habit.habit_key;
  const remove = useEntryMutation(entry, () =>
    deleteHabit(day, habit.habit_key),
  );
  return (
    <li className="body-row">
      <div className="body-row-text">
        <strong>{label}</strong>
        <span>
          {[
            habit.amount !== null && displayNumber(habit.amount),
            habit.note,
            sourceLabel(habit.source),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="body-row-actions">
        <DeleteButton
          label={label}
          disabled={!entry.online || remove.isPending}
          remove={() => remove.mutate(undefined)}
        />
      </div>
      {remove.isError && <p role="alert">Couldn’t delete habit</p>}
    </li>
  );
}

function DeleteButton({
  label,
  disabled,
  remove,
}: {
  label: string;
  disabled: boolean;
  remove: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete ${label}`}
      className={press}
      disabled={disabled}
      onClick={remove}
    >
      <Trash2 />
    </Button>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("body-field", className)}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

function SubmitButton({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      className={cn("w-full", press)}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function SetFields({
  rows,
  setRows,
  disabled,
}: {
  rows: SetRow[];
  setRows: (rows: SetRow[]) => void;
  disabled: boolean;
}) {
  const change = (index: number, update: Partial<SetRow>) =>
    setRows(
      rows.map((row, position) =>
        position === index ? { ...row, ...update } : row,
      ),
    );
  return (
    <fieldset className="body-sets">
      <legend>Sets</legend>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
        <div key={index} className="body-set">
          <Field label="Exercise" className="exercise">
            {(id) => (
              <Input
                id={id}
                required
                maxLength={80}
                value={row.exercise}
                disabled={disabled}
                onChange={(event) =>
                  change(index, { exercise: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Reps">
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                className="numeric"
                value={row.reps}
                disabled={disabled}
                onChange={(event) =>
                  change(index, { reps: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Load">
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className="numeric"
                value={row.load}
                disabled={disabled}
                onChange={(event) =>
                  change(index, { load: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select
                id={id}
                value={row.load_unit}
                disabled={disabled}
                onChange={(event) =>
                  change(index, {
                    load_unit: event.target.value === "lb" ? "lb" : "kg",
                  })
                }
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            )}
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove set ${index + 1}`}
            className={cn("self-end", press)}
            disabled={disabled}
            onClick={() =>
              setRows(rows.filter((_row, position) => position !== index))
            }
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className={press}
        disabled={disabled || rows.length >= maxSets}
        onClick={() => setRows([...rows, blankSet()])}
      >
        <Plus />
        Add set
      </Button>
    </fieldset>
  );
}

const maxSets = 40;
const quickKinds = [
  ["sauna", "Sauna"],
  ["cold_plunge", "Cold plunge"],
] as const;
type QuickKind = (typeof quickKinds)[number][0];

function Recovery(entry: EntryProps) {
  const [sheet, setSheet] = useState<{ open: boolean; kind: QuickKind }>({
    open: false,
    kind: "sauna",
  });
  const [minutes, setMinutes] = useState("");
  const [senders] = useState(() => ({
    sauna: withClientId(logActivity),
    cold_plunge: withClientId(logActivity),
  }));
  const quick = useEntryMutation(
    entry,
    (kind: QuickKind) =>
      senders[kind]({
        kind,
        started_at: new Date(
          Date.now() - Number(minutes) * 60_000,
        ).toISOString(),
        duration_minutes: Number(minutes),
      }),
    () => {
      setMinutes("");
      setSheet((current) => ({ ...current, open: false }));
    },
  );
  const busy = !entry.online || quick.isPending;
  const title = quickKinds.find(([kind]) => kind === sheet.kind)?.[1] ?? "";
  return (
    <section className="body-section" aria-labelledby="body-recovery">
      <div className="body-head">
        <h2 id="body-recovery">Recovery</h2>
      </div>
      <div className="body-quick">
        {quickKinds.map(([kind, label]) => (
          <Button
            key={kind}
            variant="secondary"
            size="lg"
            className={press}
            disabled={busy}
            onClick={() => {
              quick.reset();
              setSheet({ open: true, kind });
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <Sheet
        open={sheet.open}
        onOpenChange={(open) => setSheet({ ...sheet, open })}
        title={title}
      >
        <form
          className="body-form"
          onSubmit={(event) => {
            event.preventDefault();
            quick.mutate(sheet.kind);
          }}
        >
          <Field label="Minutes">
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                required
                min="1"
                max="1440"
                step="1"
                className="numeric"
                value={minutes}
                disabled={busy}
                onChange={(event) => setMinutes(event.target.value)}
              />
            )}
          </Field>
          {quick.isError && <p role="alert">Couldn’t save</p>}
          <SubmitButton disabled={busy}>Log {title.toLowerCase()}</SubmitButton>
        </form>
      </Sheet>
    </section>
  );
}

function LogButton({
  disabled,
  open,
  children,
}: {
  disabled: boolean;
  open: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("text-accent", press)}
      disabled={disabled}
      onClick={open}
    >
      <Plus />
      {children}
    </Button>
  );
}

function LogHabit({ day, ...entry }: EntryProps & { day: string }) {
  const [open, setOpen] = useState(false);
  const [habitKey, setHabitKey] = useState("evening_alcohol");
  const [amount, setAmount] = useState("");
  const habit = useEntryMutation(
    entry,
    () =>
      logHabit({
        habit_key: habitKey,
        day,
        ...(amount.trim() === "" ? {} : { amount: Number(amount) }),
      }),
    () => {
      setAmount("");
      setOpen(false);
    },
  );
  const busy = !entry.online || habit.isPending;
  return (
    <>
      <LogButton
        disabled={busy}
        open={() => {
          habit.reset();
          setOpen(true);
        }}
      >
        Log habit
      </LogButton>
      <Sheet open={open} onOpenChange={setOpen} title="Log habit">
        <form
          className="body-form"
          onSubmit={(event) => {
            event.preventDefault();
            habit.mutate(undefined);
          }}
        >
          <Field label="Habit">
            {(id) => (
              <select
                id={id}
                value={habitKey}
                disabled={busy}
                onChange={(event) => setHabitKey(event.target.value)}
              >
                {Object.entries(habitLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Amount">
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                className="numeric"
                value={amount}
                disabled={busy}
                onChange={(event) => setAmount(event.target.value)}
              />
            )}
          </Field>
          {habit.isError && <p role="alert">Couldn’t save</p>}
          <SubmitButton disabled={busy}>Log habit</SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

type WorkoutDraft = { kind: string; minutes: string; rows: SetRow[] };
const blankWorkout = (): WorkoutDraft => ({
  kind: "strength",
  minutes: "",
  rows: [blankSet()],
});

function LogWorkout({ day, ...entry }: EntryProps & { day: string }) {
  const [open, setOpen] = useState(false);
  const [workout, setWorkout] = useState(blankWorkout);
  const [send] = useState(() => withClientId(logActivity));
  const logWorkout = useEntryMutation(
    entry,
    (draft: WorkoutDraft) =>
      send({
        kind: draft.kind.trim(),
        sets: draft.rows.map(setInput),
        ...(draft.minutes.trim() === ""
          ? { timing: "date_only", day }
          : {
              started_at: new Date(
                Date.now() - Number(draft.minutes) * 60_000,
              ).toISOString(),
              duration_minutes: Number(draft.minutes),
            }),
      }),
    () => setOpen(false),
  );
  const busy = !entry.online || logWorkout.isPending;
  return (
    <>
      <LogButton
        disabled={busy}
        open={() => {
          setWorkout(blankWorkout());
          logWorkout.reset();
          setOpen(true);
        }}
      >
        Log workout
      </LogButton>
      <Sheet open={open} onOpenChange={setOpen} title="Log workout">
        <form
          className="body-form"
          onSubmit={(event) => {
            event.preventDefault();
            logWorkout.mutate(workout);
          }}
        >
          <div className="body-pair">
            <Field label="Kind">
              {(id) => (
                <Input
                  id={id}
                  required
                  maxLength={60}
                  value={workout.kind}
                  disabled={busy}
                  onChange={(event) =>
                    setWorkout({ ...workout, kind: event.target.value })
                  }
                />
              )}
            </Field>
            <Field label="Minutes, blank if unknown">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="1440"
                  step="1"
                  className="numeric"
                  value={workout.minutes}
                  disabled={busy}
                  onChange={(event) =>
                    setWorkout({ ...workout, minutes: event.target.value })
                  }
                />
              )}
            </Field>
          </div>
          <SetFields
            rows={workout.rows}
            setRows={(rows) => setWorkout({ ...workout, rows })}
            disabled={busy}
          />
          {logWorkout.isError && <p role="alert">Couldn’t save</p>}
          <SubmitButton disabled={busy}>Log workout</SubmitButton>
        </form>
      </Sheet>
    </>
  );
}

export function ConnectedSources({
  person,
  timezone,
  online,
  callbackResult = null,
  navigate = (url) => window.location.assign(url),
}: {
  person: number;
  timezone: string;
  online: boolean;
  callbackResult?: string | null;
  navigate?: (url: string) => void;
}) {
  const connection = useQuery({
    queryKey: ouraKey(person),
    queryFn: ({ signal }) => readOura(signal),
    enabled: online,
  });
  // Stays pending through the navigation so the indicator holds until the page leaves.
  const connect = useMutation({
    mutationFn: () =>
      connectOura(navigate).then(() => new Promise<never>(() => {})),
  });
  const { reset } = connect;
  useEffect(() => onPageRestored(window, reset), [reset]);
  if (connection.isError) return <p role="alert">Couldn’t load Oura</p>;
  if (!connection.data) return null;
  const view = ouraView(connection.data);
  if (view.state === "hidden") return null;
  const label =
    view.state === "disconnected" ? "Connect Oura" : "Reconnect Oura";
  return (
    <section className="oura" aria-label="Connected sources">
      <h3>Connected sources</h3>
      {view.state === "connected" && (
        <>
          <p>Oura connected</p>
          <p>
            {view.lastSynced ? (
              <>
                Last synced{" "}
                <time dateTime={view.lastSynced}>
                  {new Date(view.lastSynced).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: timezone,
                  })}
                </time>
              </>
            ) : (
              "Not synced yet"
            )}
          </p>
        </>
      )}
      {view.state === "membership" && <p>Oura membership required</p>}
      {view.state === "authorization" && (
        <p>
          {callbackResult === "no_data"
            ? "Allow Daily when you reconnect Oura"
            : "Oura sign-in expired"}
        </p>
      )}
      {view.state === "restored" && (
        <p>Oura needs reconnecting after a restore</p>
      )}
      {canConnectOura(view) && (
        <button
          type="button"
          disabled={!online || connect.isPending}
          onClick={() => connect.mutate()}
        >
          {label}
        </button>
      )}
      {connect.isPending && <output aria-busy="true">Connecting...</output>}
      {connect.isError && <p role="alert">Couldn’t connect Oura</p>}
    </section>
  );
}
