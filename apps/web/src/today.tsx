import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { Tabs } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { Session } from "./api.ts";
import {
  type BodyUnits,
  formatBodyWeight,
  type MeasurementDraft,
  weightDraftKg,
  weightInput,
  weightUnit,
} from "./body-units.ts";
import { refreshDays } from "./days-api.ts";
import { EatingOutSwitch } from "./eating-out.tsx";
import { BodyCard } from "./health.tsx";
import type { OutboxReplay } from "./outbox-replay.ts";
import type { QueueEntry } from "./outbox-store.ts";
import { TargetCard } from "./profile.tsx";
import { questionsKey, readQuestions } from "./questions-api.ts";
import { Button, cn, TabsList, TabsTrigger } from "./shared/ui/index.ts";
import { DaySignOff } from "./sign-off.tsx";
import { Disclosure, press, Slots } from "./slots.tsx";
import {
  changeIntake,
  changeWeight,
  dismissTargetNotice,
  displayNumber,
  type Intake,
  intakeChanges,
  intakeTagChanges,
  nutrientLabels,
  nutrients,
  refreshToday,
  settledSince,
  sourceName,
  type TodayData,
  todayQuery,
  totalText,
  type Weight,
} from "./today-api.ts";
import { WorkoutGuideEntry } from "./workout-guide-screen.tsx";

export function Today({
  person,
  records,
  online,
  units = "metric",
}: {
  person: Session["user"];
  records: QueueEntry[];
  online: boolean;
  units?: BodyUnits;
}) {
  const client = useQueryClient();
  const today = useQuery({ ...todayQuery(person.id), enabled: online });
  const questions = useQuery({
    queryKey: questionsKey(person.id),
    queryFn: ({ signal }) => readQuestions(signal),
    enabled: online,
  });
  const saved = new Set(
    [...(today.data?.entries ?? []), ...(today.data?.weights ?? [])].map(
      (entry) => entry.client_id,
    ),
  );
  const pending = records.filter(
    (entry) => entry.state === "pending" && !saved.has(entry.client_id),
  );
  const open = questions.data?.length ?? 0;
  const status = today.isError ? (
    <p role="alert">Couldn’t load today</p>
  ) : (
    !today.data &&
    !online && <p className="m-0 text-ink-2">Today unavailable offline</p>
  );
  return (
    <section aria-label="Today" className="today-screen pt-2 pb-6">
      <div className="page-head items-start">
        <div>
          <h1 className="mb-1">Today</h1>
          <p className="m-0 min-h-[1.45em] text-ink-2">
            {today.data && dayLabel(today.data.day)}
          </p>
        </div>
        {open > 0 && (
          <Link
            to="/questions"
            className={cn(
              "mt-4 inline-flex min-h-11 items-center gap-1 font-medium text-accent no-underline",
              press,
            )}
          >
            {open} {open === 1 ? "question" : "questions"}
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        )}
      </div>
      {/* The bare Radix root and panels carry no data-slot, so Body keeps its base styles. */}
      <Tabs.Root
        defaultValue="food"
        className="group/tabs mt-3 flex flex-col gap-5"
      >
        <TabsList
          variant="line"
          aria-label="Today view"
          className="w-full border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-11 md:w-88"
        >
          <TabsTrigger value="food" className={tab}>
            Food
          </TabsTrigger>
          <TabsTrigger value="body" className={tab}>
            Body
          </TabsTrigger>
        </TabsList>
        <Tabs.Content value="food" forceMount className={enter}>
          {status}
          <div className="grid gap-5 md:grid-cols-2 md:grid-rows-[auto_auto_auto_1fr] md:gap-x-8">
            {(today.data || (online && !today.isError)) && (
              <div className="order-1 md:col-start-1">
                <Remaining today={today.data} />
              </div>
            )}
            <Slots person={person.id} online={online} />
            {today.data?.target_notice && (
              <div className="order-3 md:col-start-1">
                <TargetNotice
                  notice={today.data.target_notice}
                  online={online}
                  refresh={() => refreshToday(client, person.id)}
                />
              </div>
            )}
            {today.data && (
              <div className="order-5 md:col-start-1">
                <Disclosure summary="All nutrients">
                  <dl className="m-0 [&_dd]:numeric">
                    {nutrients.map((key) => (
                      <div key={key}>
                        <dt>{nutrientLabels[key]}</dt>
                        <dd>{totalText(today.data.totals[key])}</dd>
                      </div>
                    ))}
                  </dl>
                </Disclosure>
                <Disclosure summary="How your target is set">
                  <div className="[&_p]:my-2 [&_section]:p-0">
                    <TargetCard today={today.data} />
                  </div>
                </Disclosure>
              </div>
            )}
            <div className="order-6 md:col-start-1">
              <FoodLog
                person={person.id}
                today={today.data}
                pending={pending}
                online={online}
                units={units}
              />
            </div>
          </div>
        </Tabs.Content>
        <Tabs.Content value="body" forceMount className={enter}>
          {status}
          <WorkoutGuideEntry
            key={person.id}
            person={person.id}
            day={today.data?.day}
            online={online}
            refresh={() => refreshToday(client, person.id)}
          />
          {today.data && (
            <BodyCard
              person={person.id}
              day={today.data.day}
              timezone={today.data.timezone}
              online={online}
            />
          )}
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}

// Both panels stay mounted so Body's queries load with Today and Food keeps an open edit form.
const enter =
  "data-[state=active]:animate-[screen-enter_var(--motion-tab)_var(--motion-ease-enter)] data-[state=inactive]:hidden";
const tab =
  "h-full duration-(--motion-tab) ease-move after:duration-(--motion-tab) group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]";

function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Calories and protein left, or a placeholder of the same size while Today loads. */
function Remaining({ today }: { today: TodayData | undefined }) {
  const metrics = [
    ["Calories left", "kcal", "", " kcal"],
    ["Protein left", "protein_g", " g", " g"],
  ] as const;
  return (
    <div
      aria-busy={!today}
      className="grid grid-cols-2 rounded-(--radius) border border-border bg-surface"
    >
      {metrics.map(([label, key, suffix, unit]) => {
        const left = today?.remaining[key] ?? null;
        const total = today?.totals[key];
        const target = today?.target.status === "ready" && today.target[key];
        return (
          <div
            key={key}
            className="min-w-0 p-4 [&+&]:border-l [&+&]:border-border"
          >
            <p className="m-0 text-ink-2">{label}</p>
            {!today ? (
              <div className="mt-1 mb-1 h-10 w-24 animate-pulse rounded-(--radius) bg-bg-sunk" />
            ) : (
              <p
                className={cn(
                  "numeric m-0 mt-1 leading-tight [overflow-wrap:anywhere]",
                  left === null ? "text-[26px]" : "text-[32px]",
                  left !== null && left < 0 && "text-caution",
                )}
              >
                {left === null
                  ? "Unknown"
                  : `${displayNumber(Math.abs(left))}${suffix}${left < 0 ? " over" : ""}`}
              </p>
            )}
            <p className="m-0 mt-2 min-h-[1.45em] text-step--1 text-ink-2">
              {total &&
                (total.complete && total.total !== null ? (
                  <>
                    <span className="numeric">
                      {displayNumber(total.total)}
                      {suffix}
                    </span>{" "}
                    eaten
                  </>
                ) : (
                  <>
                    <span className="numeric">
                      {displayNumber(total.known_subtotal)}
                      {suffix}
                    </span>{" "}
                    + incomplete eaten
                  </>
                ))}
            </p>
            <p className="m-0 min-h-[1.45em] text-step--1 text-ink-2">
              {today &&
                (target === false ? (
                  "No target yet"
                ) : (
                  <>
                    <span className="numeric text-ink">
                      {displayNumber(target)}
                    </span>
                    {unit} target
                  </>
                ))}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function FoodLog({
  person,
  today,
  pending,
  online,
  units,
}: {
  person: number;
  today: TodayData | undefined;
  pending: QueueEntry[];
  online: boolean;
  units: BodyUnits;
}) {
  const client = useQueryClient();
  return (
    <section aria-label="Food log" className="p-0">
      <h2 className="mt-2 mb-1">Food log</h2>
      <ul className={list} aria-label="Pending entries">
        {pending.map((entry) => (
          <li key={entry.client_id} className={row}>
            <strong>
              {entry.kind === "weight"
                ? `${formatBodyWeight(Number(entry.body.weight_kg), units)} ${weightUnit(units)}`
                : String(entry.body.name ?? "Food")}
            </strong>
            <span className="col-span-2 justify-self-end rounded-(--radius) bg-bg-sunk px-2 py-0.5 text-step--1 text-ink-2">
              Pending
            </span>
          </li>
        ))}
      </ul>
      {today && (
        <>
          <ul className={list}>
            {today.entries.map((entry) => (
              <IntakeEntry
                key={entry.id}
                entry={entry}
                timezone={today.timezone}
                online={online}
                refresh={async () => {
                  await Promise.all([
                    refreshToday(client, person),
                    refreshDays(client, person),
                  ]);
                }}
              />
            ))}
          </ul>
          {today.entries.length === 0 && (
            <p className="my-3 text-ink-2">No food entries</p>
          )}
          {today.weights.length > 0 && (
            <ul className={list} aria-label="Weights">
              {today.weights.map((entry) => (
                <WeightEntry
                  key={entry.id}
                  units={units}
                  entry={entry}
                  timezone={today.timezone}
                  online={online}
                  refresh={() => refreshToday(client, person)}
                />
              ))}
            </ul>
          )}
          <div className="[&_section]:pt-4 [&_section]:pb-0">
            <DaySignOff
              person={person}
              today={today.day}
              timezone={today.timezone}
              online={online}
            />
          </div>
        </>
      )}
    </section>
  );
}

const list = "m-0 list-none p-0";
const row =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 border-b border-border py-3 [overflow-wrap:anywhere]";
const meta = "block text-step--1 text-ink-2";
const timeOf = (stamp: string, timezone: string) =>
  new Date(stamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });

/** Refreshes Today and the day history when queued entries settle, on every tab. */
export function useSettledRefresh(
  person: number,
  replay: OutboxReplay,
  records: QueueEntry[],
) {
  const client = useQueryClient();
  const currentRecords = useRef(records);
  currentRecords.current = records;
  useEffect(() => {
    let previousPending = new Set(
      currentRecords.current
        .filter(
          (entry) => entry.person_id === person && entry.state === "pending",
        )
        .map((entry) => entry.client_id),
    );
    const unsubscribe = replay.subscribe((snapshot) => {
      const changes = settledSince(previousPending, snapshot, person);
      previousPending = changes.pending;
      if (changes.settled)
        void Promise.all([
          refreshToday(client, person),
          refreshDays(client, person),
        ]);
    });
    return () => {
      unsubscribe();
    };
  }, [client, replay, person]);
}

function TargetNotice({
  notice,
  online,
  refresh,
}: {
  notice: NonNullable<TodayData["target_notice"]>;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const dismiss = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await dismissTargetNotice(notice.id);
    },
    onSuccess: refresh,
  });
  return (
    <section
      aria-label="Target changed"
      className="flex items-start gap-3 rounded-(--radius) bg-bg-sunk py-3 pr-2 pl-4"
    >
      <div className="grow">
        <p className="m-0 font-semibold">Target changed</p>
        <p className="m-0 mt-1 text-step--1 text-ink-2">
          {(
            [
              [notice.old_kcal, notice.new_kcal, "kcal"],
              [notice.old_protein_g, notice.new_protein_g, "g protein"],
            ] as const
          )
            .filter(([before, after]) => before !== after)
            .map(([before, after, unit]) => (
              <span key={unit} className="mr-3 inline-block">
                <span className="numeric">
                  {displayNumber(before)} → {displayNumber(after)}
                </span>{" "}
                {unit}
              </span>
            ))}
        </p>
        {dismiss.isError && <p role="alert">Couldn’t dismiss</p>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss"
        className={press}
        disabled={!online || dismiss.isPending}
        onClick={() => dismiss.mutate()}
      >
        <X />
      </Button>
    </section>
  );
}
function IntakeEntry({
  entry,
  timezone,
  online,
  refresh,
}: {
  entry: Intake;
  timezone: string;
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
  const name = entry.name ?? "Food";
  return (
    <li className={row}>
      <div>
        <strong>{name}</strong>
        <span className={meta}>
          {timeOf(entry.eaten_at, timezone)} · {entry.provenance}
          {entry.source && ` · ${sourceName(entry.source)}`}
          {entry.eating_out && " · Eating out"}
        </span>
      </div>
      <div className="numeric text-right whitespace-nowrap">
        {entry.kcal === null ? "Unknown" : `${displayNumber(entry.kcal)} kcal`}
        <span className={meta}>
          {entry.protein_g === null
            ? "Protein unknown"
            : `${displayNumber(entry.protein_g)} g protein`}
        </span>
      </div>
      <RowActions
        label={entry.name ?? "food"}
        disabled={!online || mutation.isPending}
        edit={() => setEditing(true)}
        remove={() => mutation.mutate(undefined)}
      />
      {mutation.isError && (
        <p role="alert" className="col-span-full m-0">
          Couldn’t update entry
        </p>
      )}
      {editing && (
        <div className="col-span-full">
          <IntakeForm
            entry={entry}
            disabled={!online || mutation.isPending}
            save={(changes) => mutation.mutate(changes)}
            cancel={() => setEditing(false)}
          />
        </div>
      )}
    </li>
  );
}

function RowActions({
  label,
  disabled,
  edit,
  remove,
}: {
  label: string;
  disabled: boolean;
  edit: () => void;
  remove: () => void;
}) {
  return (
    <div className="flex">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit ${label}`}
        className={press}
        disabled={disabled}
        onClick={edit}
      >
        <Pencil />
      </Button>
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
    </div>
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
  const servingsChanged = Number(servings) !== original.servings;
  const [eatingOut, setEatingOut] = useState(original.eating_out);
  const [postedMenu, setPostedMenu] = useState(original.kcal_basis === "menu");
  const canSetMenu =
    !reference && entry.can_tag_eating_out === true && values.kcal !== "";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const changes = reference
          ? {
              ...intakeTagChanges(original, eatingOut),
              ...(servingsChanged ? { servings: Number(servings) } : {}),
            }
          : intakeChanges(
              original,
              values,
              eatingOut,
              canSetMenu ? postedMenu : undefined,
            );
        if (Object.keys(changes).length === 0) cancel();
        else save(changes);
      }}
    >
      <fieldset disabled={disabled}>
        <legend>Edit {entry.name ?? "food"}</legend>
        <EatingOutSwitch
          checked={eatingOut}
          eligible={entry.can_tag_eating_out === true}
          onChange={setEatingOut}
        />
        {reference ? (
          <label>
            Servings
            <input
              type="number"
              min={servingsChanged ? "0.01" : undefined}
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
        {!reference && (
          <label
            className={cn(
              "flex items-center gap-2 text-sm",
              !canSetMenu && "invisible",
            )}
          >
            <input
              type="checkbox"
              data-slot="checkbox"
              className="size-4 shrink-0 accent-accent"
              checked={canSetMenu && postedMenu}
              onChange={(event) => setPostedMenu(event.target.checked)}
            />
            Posted menu kcal
          </label>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" className={press} disabled={disabled}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={press}
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function WeightEntry({
  entry,
  timezone,
  online,
  refresh,
  units,
}: {
  entry: Weight;
  units: BodyUnits;
  timezone: string;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<
    MeasurementDraft & { originalKg: number }
  >();
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async (changes: Record<string, unknown> | undefined) => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await changeWeight(entry.id, changes);
    },
    onSuccess: async () => {
      setDraft(undefined);
      await refresh();
    },
  });
  const label = `${formatBodyWeight(entry.weight_kg, units)} ${weightUnit(units)}`;
  return (
    <li className={row}>
      <div>
        <strong>{label}</strong>
        <span className={meta}>
          <time dateTime={entry.measured_at}>
            {timeOf(entry.measured_at, timezone)}
          </time>
          {entry.source && ` · ${sourceName(entry.source)}`}
        </span>
      </div>
      <span />
      <RowActions
        label={label}
        disabled={!online || mutation.isPending}
        edit={() => {
          setDraft({
            text: weightInput(entry.weight_kg, units),
            units,
            originalKg: entry.weight_kg,
          });
        }}
        remove={() => mutation.mutate(undefined)}
      />
      {mutation.isError && (
        <p role="alert" className="col-span-full m-0">
          Couldn’t update entry
        </p>
      )}
      {draft && (
        <form
          className="col-span-full"
          onSubmit={(event) => {
            event.preventDefault();
            const weight_kg = weightDraftKg(draft, draft.originalKg);
            if (weight_kg === draft.originalKg) setDraft(undefined);
            else mutation.mutate({ weight_kg });
          }}
        >
          <label>
            Weight ({weightUnit(draft.units)})
            <input
              type="number"
              min={
                draft.text === weightInput(draft.originalKg, draft.units)
                  ? undefined
                  : "0.01"
              }
              step="any"
              required
              value={draft.text}
              disabled={!online || mutation.isPending}
              onChange={(event) =>
                setDraft({ ...draft, text: event.target.value })
              }
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              className={press}
              disabled={!online || mutation.isPending}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={press}
              onClick={() => setDraft(undefined)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
