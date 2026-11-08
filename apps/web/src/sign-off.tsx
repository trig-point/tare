import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type DayData,
  type DayMetadata,
  dayKey,
  nextUnsignedDay,
  readDay,
  readUnsignedDays,
  refreshDays,
  type SignOffValues,
  signOffDay,
  signOffValues,
  unsignedKey,
} from "./days-api.ts";
import {
  displayNumber,
  nutrientLabels,
  nutrients,
  totalText,
} from "./today-api.ts";

export function DaySignOff({
  person,
  today,
  timezone,
  online,
}: {
  person: number;
  today: string;
  timezone: string;
  online: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const unsigned = useQuery({
    queryKey: unsignedKey(person),
    queryFn: ({ signal }) => readUnsignedDays(signal),
    enabled: online,
  });
  const current = useQuery({
    queryKey: dayKey(person, today),
    queryFn: ({ signal }) => readDay(today, signal),
    enabled: online,
  });
  return (
    <section aria-label="Sign off">
      <h2>Sign off</h2>
      {open ? (
        <DayReview
          person={person}
          day={open}
          timezone={timezone}
          online={online}
          next={nextUnsignedDay(unsigned.data ?? [], open)}
          open={setOpen}
          close={() => setOpen(null)}
        />
      ) : (
        <>
          <p>
            <button
              type="button"
              disabled={!online}
              onClick={() => setOpen(today)}
            >
              Review today
            </button>{" "}
            {current.data && (
              <DayStatus day={current.data} timezone={timezone} />
            )}
          </p>
          <UnsignedDays
            days={unsigned.data}
            failed={unsigned.isError}
            online={online}
            open={setOpen}
          />
        </>
      )}
    </section>
  );
}

export function UnsignedDays({
  days,
  failed,
  online,
  open,
}: {
  days: DayMetadata[] | undefined;
  failed: boolean;
  online: boolean;
  open: (day: string) => void;
}) {
  if (failed) return <p role="alert">Couldn’t load unsigned days</p>;
  if (!days) return <p>{online ? "Loading..." : "Unavailable offline"}</p>;
  if (days.length === 0) return <p>All past days signed off</p>;
  return (
    <ul className="entries" aria-label="Unsigned days">
      {days.map((entry) => (
        <li key={entry.day}>
          <strong>{entry.day}</strong>
          <button
            type="button"
            aria-label={`Review ${entry.day}`}
            disabled={!online}
            onClick={() => open(entry.day)}
          >
            Review
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DayStatus({
  day,
  timezone,
}: {
  day: DayMetadata;
  timezone: string;
}) {
  if (day.signed_off_at === null)
    return <span className="day-status">Not signed off</span>;
  return (
    <span className="day-status complete">
      Complete{" "}
      <time dateTime={day.signed_off_at}>
        {new Date(day.signed_off_at).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: timezone,
        })}
      </time>
    </span>
  );
}

export function DayReview({
  person,
  day,
  timezone,
  online,
  next,
  open,
  close,
}: {
  person: number;
  day: string;
  timezone: string;
  online: boolean;
  next: string | null;
  open: (day: string) => void;
  close: () => void;
}) {
  const ledger = useQuery({
    queryKey: dayKey(person, day),
    queryFn: ({ signal }) => readDay(day, signal),
    enabled: online,
  });
  return (
    <section aria-label={`Day ${day}`}>
      <h3>{day}</h3>
      {ledger.isError && <p role="alert">Couldn’t load day</p>}
      {!ledger.data && !ledger.isError && (
        <p>{online ? "Loading..." : "Unavailable offline"}</p>
      )}
      {ledger.data && (
        <DayLedger
          person={person}
          data={ledger.data}
          timezone={timezone}
          online={online}
        />
      )}
      {next && (
        <button type="button" onClick={() => open(next)}>
          Next day
        </button>
      )}
      <button type="button" onClick={close}>
        Back
      </button>
    </section>
  );
}

function DayLedger({
  person,
  data,
  timezone,
  online,
}: {
  person: number;
  data: DayData;
  timezone: string;
  online: boolean;
}) {
  return (
    <>
      <p>
        <DayStatus day={data} timezone={timezone} />
      </p>
      <dl className="totals">
        {nutrients.map((key) => (
          <div key={key}>
            <dt>{nutrientLabels[key]}</dt>
            <dd>{totalText(data.totals[key])}</dd>
          </div>
        ))}
      </dl>
      <ul className="entries" aria-label="Day entries">
        {data.entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.name ?? "Food"}</strong>
            <span>
              {entry.kcal === null
                ? "Incomplete"
                : `${displayNumber(entry.kcal)} kcal`}
            </span>
          </li>
        ))}
      </ul>
      {data.entries.length === 0 && <p>No food entries</p>}
      {data.signed_off_at === null && (
        <SignOffForm
          key={data.day}
          person={person}
          day={data}
          online={online}
        />
      )}
    </>
  );
}

const ratings = ["1", "2", "3", "4", "5"];

function SignOffForm({
  person,
  day,
  online,
}: {
  person: number;
  day: DayMetadata;
  online: boolean;
}) {
  const client = useQueryClient();
  const [seeded] = useState(() => signOffValues(day));
  const [values, setValues] = useState<SignOffValues>(seeded);
  const save = useMutation({
    mutationFn: () => signOffDay(day.day, seeded, values),
    onSuccess: async (saved) => {
      client.setQueryData<DayData>(dayKey(person, day.day), (previous) =>
        previous ? { ...previous, ...saved } : previous,
      );
      await refreshDays(client, person);
    },
  });
  const field = (name: keyof SignOffValues) => ({
    id: `sign-off-${name}`,
    value: values[name],
    onChange: (event: { target: { value: string } }) =>
      setValues({ ...values, [name]: event.target.value }),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={!online || save.isPending}>
        {(["hunger", "fullness"] as const).map((name) => (
          <div key={name}>
            <label htmlFor={`sign-off-${name}`}>
              {name === "hunger" ? "Hunger (1 to 5)" : "Fullness (1 to 5)"}
            </label>
            <select {...field(name)}>
              <option value="">Not set</option>
              {ratings.map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
          </div>
        ))}
        <label htmlFor="sign-off-notes">Notes</label>
        <textarea {...field("notes")} maxLength={2000} />
        <button type="submit">
          {save.isPending ? "Signing off..." : "Sign off"}
        </button>
      </fieldset>
      {save.isError && <p role="alert">Couldn’t sign off</p>}
    </form>
  );
}
