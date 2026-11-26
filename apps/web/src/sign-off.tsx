import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
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
import { Button, cn, Textarea } from "./shared/ui/index.ts";
import {
  displayNumber,
  type Intake,
  nutrientLabels,
  nutrients,
  totalText,
} from "./today-api.ts";

const press =
  "transition-transform duration-(--motion-press) ease-move active:scale-[0.97]";
const enter =
  "animate-[screen-enter_var(--motion-tab)_var(--motion-ease-enter)]";
const hint = "text-sm text-ink-2";
const row =
  "flex min-h-14 items-center gap-3 border-b border-border py-3 [overflow-wrap:anywhere]";

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
    <section aria-label="Sign off" className="grid gap-4 py-6">
      <h2 className="m-0 text-(length:--step-2) font-semibold tracking-tight">
        Sign off
      </h2>
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
        <div className={cn("grid gap-4", enter)}>
          <div className="flex items-center justify-between gap-3 rounded-(--radius) border border-border bg-surface p-4">
            <div className="grid min-w-0 gap-0.5">
              <span className="font-medium">{dayTitle(today)}</span>
              <span className="min-h-5 text-sm">
                {current.data ? (
                  <DayStatus day={current.data} timezone={timezone} />
                ) : (
                  <span className="text-ink-3">
                    {online ? "" : "Unavailable offline"}
                  </span>
                )}
              </span>
            </div>
            <Button
              type="button"
              className={cn(press, "min-h-11 px-5")}
              disabled={!online}
              onClick={() => setOpen(today)}
            >
              Review today
            </Button>
          </div>
          <UnsignedDays
            days={unsigned.data}
            failed={unsigned.isError}
            online={online}
            open={setOpen}
          />
        </div>
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
  const heading = (
    <h3 className="m-0 flex items-baseline justify-between text-base font-semibold">
      Past days
      {days && days.length > 0 && (
        <span className="numeric text-sm font-normal text-ink-2">
          {days.length} unsigned
        </span>
      )}
    </h3>
  );
  if (failed)
    return (
      <div className="grid gap-2">
        {heading}
        <p role="alert" className="m-0 text-needs-human">
          Couldn’t load unsigned days
        </p>
      </div>
    );
  if (!days)
    return (
      <div className="grid gap-2">
        {heading}
        {online ? (
          <Skeleton label="Loading unsigned days" className="h-28" />
        ) : (
          <p className={cn(hint, "m-0")}>Unavailable offline</p>
        )}
      </div>
    );
  if (days.length === 0)
    return (
      <div className="grid gap-2">
        {heading}
        <p className={cn(hint, "m-0")}>All past days signed off</p>
      </div>
    );
  return (
    <div className="grid gap-1">
      {heading}
      <ul className="m-0 list-none p-0" aria-label="Unsigned days">
        {days.map((entry) => (
          <li key={entry.day} className={row}>
            <strong className="min-w-0 flex-1 font-medium">
              {dayTitle(entry.day)}
            </strong>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(press, "min-h-9 px-4")}
              aria-label={`Review ${entry.day}`}
              disabled={!online}
              onClick={() => open(entry.day)}
            >
              Review
            </Button>
          </li>
        ))}
      </ul>
    </div>
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
    return <span className="day-status text-ink-2">Not signed off</span>;
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
    <section
      key={day}
      aria-label={`Day ${day}`}
      className={cn("grid gap-4 py-0!", enter)}
    >
      <div className="grid gap-0.5">
        <h3 className="m-0 text-(length:--step-1) font-semibold">
          {dayTitle(day)}
        </h3>
        <span className="min-h-5 text-sm">
          {ledger.data && <DayStatus day={ledger.data} timezone={timezone} />}
        </span>
      </div>
      {ledger.isError && (
        <p role="alert" className="m-0 text-needs-human">
          Couldn’t load day
        </p>
      )}
      {!ledger.data &&
        !ledger.isError &&
        (online ? (
          <Skeleton label="Loading day" className="h-64" />
        ) : (
          <p className={cn(hint, "m-0")}>Unavailable offline</p>
        ))}
      {ledger.data && (
        <DayLedger
          person={person}
          data={ledger.data}
          timezone={timezone}
          online={online}
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          className={cn(press, "-mx-2 min-h-11 px-3")}
          onClick={close}
        >
          Back
        </Button>
        {next && (
          <Button
            type="button"
            variant="outline"
            className={cn(press, "min-h-11 px-4")}
            onClick={() => open(next)}
          >
            Next day
          </Button>
        )}
      </div>
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
  const count = data.entries.length;
  return (
    <>
      <div className="grid gap-1">
        <h4 className="m-0 flex items-baseline justify-between text-base font-semibold">
          Entries
          <span className="numeric text-sm font-normal text-ink-2">
            {count === 1 ? "1 food" : `${count} foods`}
          </span>
        </h4>
        {count === 0 ? (
          <p className={cn(hint, "m-0 border-b border-border py-3")}>
            No food entries
          </p>
        ) : (
          <ul className="m-0 list-none p-0" aria-label="Day entries">
            {data.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} timezone={timezone} />
            ))}
          </ul>
        )}
        <DayTotals data={data} />
      </div>
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

function EntryRow({ entry, timezone }: { entry: Intake; timezone: string }) {
  const eaten = new Date(entry.eaten_at);
  return (
    <li className={cn(row, "justify-between")}>
      <div className="grid min-w-0 gap-0.5">
        <strong className="font-medium">{entry.name ?? "Food"}</strong>
        {entry.eating_out && (
          <span className="text-sm text-ink-2">Eating out</span>
        )}
        {!Number.isNaN(eaten.getTime()) && (
          <span className="text-sm text-ink-2">
            {eaten.toLocaleTimeString([], {
              timeStyle: "short",
              timeZone: timezone,
            })}
          </span>
        )}
      </div>
      <div className="grid shrink-0 justify-items-end gap-0.5 text-right">
        <span className="numeric">
          {entry.kcal === null
            ? "Unknown"
            : `${displayNumber(entry.kcal)} kcal`}
        </span>
        <span className="numeric text-sm text-ink-2">
          {entry.protein_g === null
            ? "Protein unknown"
            : `${displayNumber(entry.protein_g)} g protein`}
        </span>
      </div>
    </li>
  );
}

function DayTotals({ data }: { data: DayData }) {
  const complete = nutrients.every((key) => data.totals[key].complete);
  return (
    <details className="group mt-0 py-2">
      <summary
        className={cn(
          press,
          "flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-md [&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="numeric min-w-0 flex-1 text-sm">
          {displayNumber(data.totals.kcal.known_subtotal)} kcal /{" "}
          {displayNumber(data.totals.protein_g.known_subtotal)} g protein
        </span>
        {!complete && (
          <span className="rounded-sm bg-caution/15 px-2 py-0.5 text-sm text-caution">
            Incomplete
          </span>
        )}
        <Plus />
        <span className="sr-only">Totals</span>
      </summary>
      <dl className="m-0 grid gap-1 pt-2">
        {nutrients.map((key) => (
          <div key={key} className="flex justify-between gap-3 text-sm">
            <dt className="text-ink-2">{nutrientLabels[key]}</dt>
            <dd className="numeric m-0">{totalText(data.totals[key])}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const ratings = ["1", "2", "3", "4", "5"];
const scales = {
  hunger: { label: "Hunger", range: "Not hungry to very hungry" },
  fullness: { label: "Fullness", range: "Not full to very full" },
};

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
  const [noteOpen, setNoteOpen] = useState(seeded.notes !== "");
  const save = useMutation({
    mutationFn: () => signOffDay(day.day, seeded, values),
    onSuccess: async (saved) => {
      client.setQueryData<DayData>(dayKey(person, day.day), (previous) =>
        previous ? { ...previous, ...saved } : previous,
      );
      await refreshDays(client, person);
    },
  });
  const set = (name: keyof SignOffValues, value: string) =>
    setValues({ ...values, [name]: value });
  return (
    <form
      className="max-w-none rounded-(--radius) border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset
        disabled={!online || save.isPending}
        className="m-0 grid min-w-0 gap-4 border-0 p-0"
      >
        {(["hunger", "fullness"] as const).map((name) => (
          <RatingScale
            key={name}
            name={name}
            value={values[name]}
            change={(value) => set(name, value)}
          />
        ))}
        <div className="grid gap-2 border-t border-border pt-2">
          <button
            type="button"
            data-slot="note-toggle"
            aria-expanded={noteOpen}
            aria-controls="sign-off-notes"
            className={cn(
              press,
              "flex min-h-11 w-full items-center justify-between rounded-md bg-transparent text-left font-medium text-ink disabled:opacity-50",
            )}
            onClick={() => setNoteOpen(!noteOpen)}
          >
            {seeded.notes === "" ? "Add a note" : "Note"}
            <Plus open={noteOpen} />
          </button>
          <div hidden={!noteOpen} className="grid gap-1.5">
            <label htmlFor="sign-off-notes" className="sr-only">
              Notes
            </label>
            <Textarea
              id="sign-off-notes"
              value={values.notes}
              maxLength={2000}
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>
        </div>
        <Button
          type="submit"
          className={cn(press, "min-h-12 w-full text-base")}
        >
          {save.isPending ? "Signing off..." : "Sign off"}
        </Button>
      </fieldset>
      {save.isError && (
        <p role="alert" className="m-0 pt-3 text-needs-human">
          Couldn’t sign off
        </p>
      )}
    </form>
  );
}

function RatingScale({
  name,
  value,
  change,
}: {
  name: "hunger" | "fullness";
  value: string;
  change: (value: string) => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const scale = scales[name];
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-describedby={hintId}
      className="grid min-w-0 gap-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="font-medium">
          {scale.label}
        </span>
        <span id={hintId} className="text-sm text-ink-2">
          {scale.range}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {ratings.map((rating) => (
          <label key={rating} className="relative">
            <input
              type="radio"
              data-slot="rating"
              className="peer sr-only"
              name={`sign-off-${name}`}
              value={rating}
              checked={value === rating}
              onChange={() => change(rating)}
              onClick={() => change(toggledRating(value, rating))}
              onKeyDown={(event) => {
                // A checked radio ignores Space natively, so Space toggles here.
                if (event.key !== " ") return;
                event.preventDefault();
                change(toggledRating(value, rating));
              }}
            />
            <span
              className={cn(
                "numeric flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-transparent transition-[transform,background-color,border-color,color] duration-(--motion-press) ease-move hover:bg-bg-sunk active:scale-[0.97] peer-checked:border-accent peer-checked:bg-accent peer-checked:text-surface peer-checked:hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
              )}
            >
              {rating}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Picking the selected rating again clears it. */
export function toggledRating(current: string, rating: string) {
  return current === rating ? "" : rating;
}

function Skeleton({ label, className }: { label: string; className: string }) {
  return (
    <div aria-busy="true" className="grid">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className={cn(
          "motion-safe:animate-pulse rounded-(--radius) bg-bg-sunk",
          className,
        )}
      />
    </div>
  );
}

function Plus({ open = false }: { open?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(
        "size-4 shrink-0 text-ink-3 transition-transform duration-(--motion-tab) ease-move group-open:rotate-45",
        open && "rotate-45",
      )}
    >
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** "2025-12-30" as "Tuesday, December 30"; the raw text when it is not a date. */
function dayTitle(day: string) {
  const date = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
