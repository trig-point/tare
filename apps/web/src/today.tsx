import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AddFood } from "./add-food.tsx";
import type { Session } from "./api.ts";
import { refreshDays } from "./days-api.ts";
import { DaySignals, OuraStatus } from "./health.tsx";
import type { OutboxReplay } from "./outbox-replay.ts";
import type { QueueEntry } from "./outbox-store.ts";
import { ProfileSection, TargetCard, WeightChart } from "./profile.tsx";
import { Questions } from "./questions.tsx";
import { DaySignOff } from "./sign-off.tsx";
import {
  changeIntake,
  changeWeight,
  displayNumber,
  enqueueWeight,
  type Intake,
  intakeChanges,
  nutrientLabels,
  nutrients,
  readToday,
  refreshToday,
  settledSince,
  sourceName,
  todayKey,
  totalText,
  type Weight,
} from "./today-api.ts";

export function Today({
  person,
  replay,
  records,
  online,
}: {
  person: Session["user"];
  replay: OutboxReplay;
  records: QueueEntry[];
  online: boolean;
}) {
  const client = useQueryClient();
  const today = useQuery({
    queryKey: todayKey(person.id),
    queryFn: ({ signal }) => readToday(signal),
    enabled: online,
  });
  const currentRecords = useRef(records);
  currentRecords.current = records;
  useEffect(() => {
    let previousPending = new Set(
      currentRecords.current
        .filter(
          (entry) => entry.person_id === person.id && entry.state === "pending",
        )
        .map((entry) => entry.client_id),
    );
    const unsubscribe = replay.subscribe((snapshot) => {
      const changes = settledSince(previousPending, snapshot, person.id);
      previousPending = changes.pending;
      if (changes.settled)
        void Promise.all([
          refreshToday(client, person.id),
          refreshDays(client, person.id),
        ]);
    });
    return () => {
      unsubscribe();
    };
  }, [client, replay, person.id]);
  const saved = new Set(
    [...(today.data?.entries ?? []), ...(today.data?.weights ?? [])].map(
      (entry) => entry.client_id,
    ),
  );
  const pending = records.filter(
    (entry) => entry.state === "pending" && !saved.has(entry.client_id),
  );
  return (
    <section aria-label="Today">
      <h1>Today</h1>
      <Questions person={person.id} online={online} />
      {today.isError && <p role="alert">Couldn’t load today</p>}
      {!today.data && !today.isError && (
        <p>{online ? "Loading..." : "Today unavailable offline"}</p>
      )}
      {today.data && (
        <>
          <p>{today.data.day}</p>
          <TargetCard today={today.data} />
          <div className="day-summary">
            <dl className="totals">
              {nutrients.map((key) => (
                <div key={key}>
                  <dt>{nutrientLabels[key]}</dt>
                  <dd>{totalText(today.data.totals[key])}</dd>
                </div>
              ))}
            </dl>
            <DaySignals
              person={person.id}
              day={today.data.day}
              online={online}
            />
          </div>
          <OuraStatus
            person={person.id}
            timezone={today.data.timezone}
            online={online}
          />
          <ul className="entries">
            {today.data.entries.map((entry) => (
              <IntakeEntry
                key={entry.id}
                entry={entry}
                online={online}
                refresh={async () => {
                  await Promise.all([
                    client.invalidateQueries({ queryKey: todayKey(person.id) }),
                    refreshDays(client, person.id),
                  ]);
                }}
              />
            ))}
          </ul>
          <ul className="entries" aria-label="Weights">
            {today.data.weights.map((entry) => (
              <WeightEntry
                key={entry.id}
                entry={entry}
                timezone={today.data.timezone}
                online={online}
                refresh={() =>
                  client.invalidateQueries({ queryKey: todayKey(person.id) })
                }
              />
            ))}
          </ul>
          {today.data.entries.length === 0 && <p>No food entries</p>}
          <DaySignOff
            person={person.id}
            today={today.data.day}
            timezone={today.data.timezone}
            online={online}
          />
        </>
      )}
      <ul className="entries" aria-label="Pending entries">
        {pending.map((entry) => (
          <li key={entry.client_id}>
            <strong>
              {entry.kind === "weight"
                ? `${displayNumber(Number(entry.body.weight_kg))} kg`
                : String(entry.body.name ?? "Food")}
            </strong>{" "}
            <span>Pending</span>
          </li>
        ))}
      </ul>
      <AddFood person={person} replay={replay} online={online} />
      <WeightForm person={person} replay={replay} />
      <WeightChart person={person.id} online={online} />
      <ProfileSection person={person.id} online={online} />
    </section>
  );
}
function WeightForm({
  person,
  replay,
}: {
  person: Session["user"];
  replay: OutboxReplay;
}) {
  const [weight, setWeight] = useState("");
  const save = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      await enqueueWeight(replay, person, weight);
    },
    onSuccess: () => setWeight(""),
  });
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>Log weight</h2>
      <label htmlFor="weight">Weight (kg)</label>
      <input
        id="weight"
        type="number"
        min="0.01"
        step="any"
        required
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
        disabled={save.isPending}
      />
      <button type="submit" disabled={save.isPending}>
        Log weight
      </button>
      {save.isError && <p role="alert">Couldn’t save weight</p>}
    </form>
  );
}
function IntakeEntry({
  entry,
  online,
  refresh,
}: {
  entry: Intake;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async (changes: Record<string, unknown> | undefined) => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await changeIntake(entry.id, changes);
    },
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  return (
    <li>
      <strong>{entry.name ?? "Food"}</strong>
      <span>
        {entry.provenance}
        {entry.source && ` · ${sourceName(entry.source)}`}
      </span>
      <span>
        {entry.kcal === null
          ? "Incomplete"
          : `${displayNumber(entry.kcal)} kcal`}
      </span>
      <button
        type="button"
        aria-label={`Edit ${entry.name ?? "food"}`}
        disabled={!online || mutation.isPending}
        onClick={() => setEditing(true)}
      >
        Edit
      </button>
      <button
        type="button"
        aria-label={`Delete ${entry.name ?? "food"}`}
        disabled={!online || mutation.isPending}
        onClick={() => mutation.mutate(undefined)}
      >
        Delete
      </button>
      {mutation.isError && <p role="alert">Couldn’t update entry</p>}
      {editing && (
        <IntakeForm
          entry={entry}
          disabled={!online || mutation.isPending}
          save={(changes) => mutation.mutate(changes)}
          cancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}
function IntakeForm({
  entry,
  disabled,
  save,
  cancel,
}: {
  entry: Intake;
  disabled: boolean;
  save: (changes: Record<string, unknown>) => void;
  cancel: () => void;
}) {
  const [original] = useState(entry);
  const reference =
    original.food_id !== null || original.source_food_id !== null;
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      nutrients.map((key) => [
        key,
        original[key] === null ? "" : String(original[key]),
      ]),
    ),
  );
  const [servings, setServings] = useState(String(original.servings ?? 1));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const changes = reference
          ? Number(servings) === original.servings
            ? {}
            : { servings: Number(servings) }
          : intakeChanges(original, values);
        if (Object.keys(changes).length === 0) cancel();
        else save(changes);
      }}
    >
      <fieldset disabled={disabled}>
        <legend>Edit {entry.name ?? "food"}</legend>
        {reference ? (
          <label>
            Servings
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={servings}
              onChange={(event) => setServings(event.target.value)}
            />
          </label>
        ) : (
          nutrients.map((key) => (
            <label key={key}>
              {nutrientLabels[key]}
              <input
                type="number"
                min="0"
                step="any"
                value={values[key]}
                onChange={(event) =>
                  setValues({ ...values, [key]: event.target.value })
                }
              />
            </label>
          ))
        )}
        <button type="submit">Save</button>
      </fieldset>
      <button type="button" onClick={cancel}>
        Cancel
      </button>
    </form>
  );
}

function WeightEntry({
  entry,
  timezone,
  online,
  refresh,
}: {
  entry: Weight;
  timezone: string;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState(String(entry.weight_kg));
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async (changes: Record<string, unknown> | undefined) => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await changeWeight(entry.id, changes);
    },
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  return (
    <li>
      <strong>{displayNumber(entry.weight_kg)} kg</strong>
      {entry.source && <span>{sourceName(entry.source)}</span>}
      <time dateTime={entry.measured_at}>
        {new Date(entry.measured_at).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
          timeZone: timezone,
          timeZoneName: "short",
        })}
      </time>
      <button
        type="button"
        aria-label={`Edit ${displayNumber(entry.weight_kg)} kg`}
        disabled={!online || mutation.isPending}
        onClick={() => {
          setWeight(String(entry.weight_kg));
          setEditing(true);
        }}
      >
        Edit
      </button>
      <button
        type="button"
        aria-label={`Delete ${displayNumber(entry.weight_kg)} kg`}
        disabled={!online || mutation.isPending}
        onClick={() => mutation.mutate(undefined)}
      >
        Delete
      </button>
      {mutation.isError && <p role="alert">Couldn’t update entry</p>}
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({ weight_kg: Number(weight) });
          }}
        >
          <label>
            Weight (kg)
            <input
              type="number"
              min="0.01"
              step="any"
              required
              value={weight}
              disabled={!online || mutation.isPending}
              onChange={(event) => setWeight(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!online || mutation.isPending}>
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
