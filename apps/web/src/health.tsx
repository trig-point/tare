import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  readSignals,
  replaceSets,
  type SetInput,
  type SetRow,
  setInput,
  setRow,
  setText,
  signalsKey,
  signalText,
  sourceLabel,
  type Workout,
  withClientId,
} from "./health-api.ts";
import { displayNumber, refreshToday } from "./today-api.ts";

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
  const signals = useQuery({
    queryKey: signalsKey(person, day),
    queryFn: ({ signal }) => readSignals(day, signal),
    enabled: online,
  });
  const connection = useQuery({
    queryKey: ouraKey(person),
    queryFn: ({ signal }) => readOura(signal),
    enabled: online,
  });
  if (signals.isError) return <p role="alert">Couldn’t load signals</p>;
  if (!signals.data) return null;
  const rows = bodyRows(signals.data.signals);
  const { activities, habits } = signals.data;
  const canConnect =
    connection.data !== undefined && canConnectOura(ouraView(connection.data));
  const entry = { online, refresh: () => refreshToday(client, person) };
  return (
    <section className="signals" aria-label="Body">
      <h2>Body</h2>
      {rows.length === 0 && activities.length === 0 && habits.length === 0 && (
        <p>Nothing logged</p>
      )}
      {rows.length === 0 && canConnect && (
        <p>
          <a href="#settings">Connect a source in Settings</a>
        </p>
      )}
      {rows.length > 0 && (
        <dl className="totals">
          {rows.map((entry) => (
            <div key={entry.metric}>
              <dt>{metricLabels[entry.metric]}</dt>
              <dd>{signalText(entry)}</dd>
              <dd className="source">{sourceLabel(entry.source)}</dd>
            </div>
          ))}
        </dl>
      )}
      {activities.length + habits.length > 0 && (
        <ul className="entries" aria-label="Activity">
          {activities.map((workout) => (
            <WorkoutEntry
              key={workout.id}
              workout={workout}
              timezone={timezone}
              {...entry}
            />
          ))}
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
      <LogControls day={day} {...entry} />
    </section>
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
  return (
    <li>
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
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setRows(
            workout.sets.length > 0 ? workout.sets.map(setRow) : [blankSet()],
          );
          setEditing(true);
        }}
      >
        {logged ? "Edit sets" : "Add sets"}
      </button>
      {logged && (
        <button
          type="button"
          aria-label={`Delete ${workout.kind}`}
          disabled={busy}
          onClick={() => remove.mutate(undefined)}
        >
          Delete
        </button>
      )}
      {(save.isError || remove.isError) && (
        <p role="alert">Couldn’t update workout</p>
      )}
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(rows.map(setInput));
          }}
        >
          <SetFields rows={rows} setRows={setRows} disabled={busy} />
          <button type="submit" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
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
    <li>
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
      <button
        type="button"
        aria-label={`Delete ${label}`}
        disabled={!entry.online || remove.isPending}
        onClick={() => remove.mutate(undefined)}
      >
        Delete
      </button>
      {remove.isError && <p role="alert">Couldn’t delete habit</p>}
    </li>
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
    <fieldset className="sets">
      <legend>Sets</legend>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
        <div key={index}>
          <label>
            Exercise
            <input
              required
              maxLength={80}
              value={row.exercise}
              disabled={disabled}
              onChange={(event) =>
                change(index, { exercise: event.target.value })
              }
            />
          </label>
          <label>
            Reps
            <input
              type="number"
              min="0"
              step="1"
              value={row.reps}
              disabled={disabled}
              onChange={(event) => change(index, { reps: event.target.value })}
            />
          </label>
          <label>
            Load
            <input
              type="number"
              min="0"
              step="any"
              value={row.load}
              disabled={disabled}
              onChange={(event) => change(index, { load: event.target.value })}
            />
          </label>
          <select
            aria-label="Unit"
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
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setRows(rows.filter((_row, position) => position !== index))
            }
          >
            Remove set
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || rows.length >= maxSets}
        onClick={() => setRows([...rows, blankSet()])}
      >
        Add set
      </button>
    </fieldset>
  );
}

const maxSets = 40;
const quickKinds = [
  ["sauna", "Sauna"],
  ["cold_plunge", "Cold plunge"],
] as const;
function LogControls({ day, ...entry }: EntryProps & { day: string }) {
  const [minutes, setMinutes] = useState("");
  const [senders] = useState(() => ({
    sauna: withClientId(logActivity),
    cold_plunge: withClientId(logActivity),
    workout: withClientId(logActivity),
  }));
  const quick = useEntryMutation(
    entry,
    (kind: (typeof quickKinds)[number][0]) =>
      senders[kind]({
        kind,
        started_at: new Date(
          Date.now() - Number(minutes) * 60_000,
        ).toISOString(),
        duration_minutes: Number(minutes),
      }),
    () => setMinutes(""),
  );
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
    () => setAmount(""),
  );
  const [workout, setWorkout] = useState<{
    kind: string;
    minutes: string;
    rows: SetRow[];
  } | null>(null);
  const logWorkout = useEntryMutation(
    entry,
    (draft: NonNullable<typeof workout>) =>
      senders.workout({
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
    () => setWorkout(null),
  );
  const busy =
    !entry.online || quick.isPending || habit.isPending || logWorkout.isPending;
  return (
    <div className="log-controls">
      <form aria-label="Quick log" onSubmit={(event) => event.preventDefault()}>
        <label>
          Minutes
          <input
            type="number"
            min="1"
            max="1440"
            step="1"
            value={minutes}
            disabled={busy}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        {quickKinds.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            disabled={busy || !(Number(minutes) >= 1)}
            onClick={() => quick.mutate(kind)}
          >
            {label}
          </button>
        ))}
      </form>
      <form
        aria-label="Log habit"
        onSubmit={(event) => {
          event.preventDefault();
          habit.mutate(undefined);
        }}
      >
        <select
          aria-label="Habit"
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
        <label>
          Amount
          <input
            type="number"
            min="0.01"
            step="any"
            value={amount}
            disabled={busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Log habit
        </button>
      </form>
      {workout === null ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setWorkout({ kind: "strength", minutes: "", rows: [blankSet()] })
          }
        >
          Log workout
        </button>
      ) : (
        <form
          aria-label="Log workout"
          onSubmit={(event) => {
            event.preventDefault();
            logWorkout.mutate(workout);
          }}
        >
          <label>
            Kind
            <input
              required
              maxLength={60}
              value={workout.kind}
              disabled={busy}
              onChange={(event) =>
                setWorkout({ ...workout, kind: event.target.value })
              }
            />
          </label>
          <label>
            Minutes, blank if unknown
            <input
              type="number"
              min="1"
              max="1440"
              step="1"
              value={workout.minutes}
              disabled={busy}
              onChange={(event) =>
                setWorkout({ ...workout, minutes: event.target.value })
              }
            />
          </label>
          <SetFields
            rows={workout.rows}
            setRows={(rows) => setWorkout({ ...workout, rows })}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setWorkout(null)}>
            Cancel
          </button>
        </form>
      )}
      {(quick.isError || habit.isError || logWorkout.isError) && (
        <p role="alert">Couldn’t save</p>
      )}
    </div>
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
