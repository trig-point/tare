import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AlignedData, Legend, Series } from "uplot";
import { ApiError, type Session } from "./api.ts";
import type { OutboxReplay } from "./outbox-replay.ts";
import {
  activityLevels,
  chartData,
  historyKey,
  type Profile,
  profileKey,
  profileValues,
  readHistory,
  readProfile,
  saveProfile,
  type WeightHistory,
} from "./profile-api.ts";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "./shared/ui/index.ts";
import { Disclosure, press } from "./slots.tsx";
import {
  bonusLines,
  displayNumber,
  enqueueWeight,
  refreshToday,
  type TodayData,
  totalText,
} from "./today-api.ts";
import "./profile.css";

const basisLabels = {
  weekly_adaptive: "Adaptive target",
  weekly_formula: "Formula target",
  live_formula: "Formula target",
};

export function TargetCard({ today }: { today: TodayData }) {
  const { target, totals, remaining } = today;
  if (target.status !== "ready")
    return (
      <section className="target" aria-label="Target">
        <p>
          {target.status === "needs_profile"
            ? "Add your profile to get a target"
            : "Log a weigh-in to get a target"}
        </p>
      </section>
    );
  const rows = [
    ["Calories", "kcal", "kcal", target.kcal],
    ["Protein", "protein_g", "g", target.protein_g],
  ] as const;
  return (
    <section className="target" aria-label="Target">
      <p>
        {basisLabels[target.basis]}
        {target.adaptive.status === "learning" && ", still learning"}
      </p>
      {bonusLines(target.base_kcal, target.bonus, today.timezone).map(
        (line) => (
          <p key={line}>{line}</p>
        ),
      )}
      <table>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Target</th>
            <th scope="col">Eaten</th>
            <th scope="col">Left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, unit, goal]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>
                {displayNumber(goal)} {unit}
              </td>
              <td>{totalText(totals[key])}</td>
              <td>
                {remaining[key] === null
                  ? "Incomplete"
                  : `${displayNumber(remaining[key])} ${unit}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export const sectionHead =
  "m-0 text-(length:--step-2) font-semibold tracking-tight";
const hint = "text-sm text-ink-2";
const row =
  "flex min-h-14 items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0";

export function ProfileSection({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const profile = useQuery({
    queryKey: profileKey(person),
    queryFn: ({ signal }) => readProfile(signal),
    enabled: online,
  });
  return (
    <section aria-label="Profile" className="grid gap-3 p-0">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className={sectionHead}>Profile</h2>
        {profile.data !== undefined && (
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className={cn(press, "text-ink-2")}
                disabled={!online}
              >
                {profile.data === null ? "Add profile" : "Edit profile"}
              </Button>
            </DialogTrigger>
            <DialogContent
              aria-describedby={undefined}
              className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-(--radius) bg-surface"
            >
              <DialogTitle>
                {profile.data === null ? "Add profile" : "Edit profile"}
              </DialogTitle>
              <ProfileForm
                person={person}
                profile={profile.data}
                online={online}
                onSaved={() => setEditing(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
      {profile.isError && (
        <p role="alert" className="m-0">
          Couldn’t load profile
        </p>
      )}
      {profile.data === undefined ? (
        profile.isError ? null : online ? (
          <Skeleton label="Loading profile" className="h-32" />
        ) : (
          <p className={cn(hint, "m-0")}>Unavailable offline</p>
        )
      ) : (
        <ProfileSummary profile={profile.data} />
      )}
    </section>
  );
}

function ProfileSummary({ profile }: { profile: Profile | null }) {
  if (profile === null)
    return <p className={cn(hint, "m-0")}>Add your profile to get a target</p>;
  const details = [
    ["Birth date", longDate(profile.birth_date)],
    ["Goal rate", `${signed.format(profile.goal_rate_kg_week)} kg/week`],
    ["Protein", `${displayNumber(profile.protein_factor)} g/kg`],
  ] as const;
  return (
    <div className="grid gap-4">
      <p className={cn(hint, "m-0")}>
        <span className="numeric">{displayNumber(profile.height_cm)} cm</span>
        {" / "}
        {profile.sex === "female" ? "Female" : "Male"}
        {" / "}
        {activityLevels[profile.activity_level]} activity
      </p>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2.5">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-2">{label}</dt>
            <dd className="numeric text-right text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ProfileForm({
  person,
  profile,
  online,
  onSaved,
}: {
  person: number;
  profile: Profile | null;
  online: boolean;
  onSaved?: () => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState(() => profileValues(profile));
  const save = useMutation({
    mutationFn: () => saveProfile(values),
    onSuccess: async (saved) => {
      client.setQueryData(profileKey(person), saved);
      onSaved?.();
      await refreshToday(client, person);
    },
  });
  const field = (key: keyof typeof values) => ({
    id: `profile-${key}`,
    value: values[key],
    required: true,
    className: "m-0",
    onChange: (event: { target: { value: string } }) => {
      save.reset();
      setValues({ ...values, [key]: event.target.value });
    },
  });
  const labelled = (key: keyof typeof values, label: string) => (
    <label htmlFor={`profile-${key}`} className="font-medium text-ink">
      {label}
    </label>
  );
  return (
    <form
      className="grid max-w-none gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset
        disabled={!online || save.isPending}
        className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0"
      >
        <div className="grid gap-1.5">
          {labelled("height_cm", "Height (cm)")}
          <input
            type="number"
            inputMode="decimal"
            min="100"
            max="250"
            step="any"
            {...field("height_cm")}
          />
        </div>
        <div className="grid gap-1.5">
          {labelled("birth_date", "Birth date")}
          <input type="date" {...field("birth_date")} />
        </div>
        <div className="grid gap-1.5">
          {labelled("sex", "Sex")}
          <select {...field("sex")}>
            {profile === null && (
              <option value="" disabled>
                Choose
              </option>
            )}
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          {labelled("activity_level", "Activity level")}
          <select {...field("activity_level")}>
            {Object.entries(activityLevels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          {labelled("goal_rate_kg_week", "Goal rate (kg/week)")}
          <input
            type="number"
            min="-1.5"
            max="1"
            step="any"
            {...field("goal_rate_kg_week")}
          />
        </div>
        <div className="grid gap-1.5">
          {labelled("protein_factor", "Protein (g/kg)")}
          <input
            type="number"
            inputMode="decimal"
            min="0.8"
            max="3"
            step="any"
            {...field("protein_factor")}
          />
        </div>
        <button type="submit" className={cn(press, "col-span-full w-full")}>
          {save.isPending ? "Saving..." : "Save profile"}
        </button>
      </fieldset>
      {save.isSuccess && <output>Saved</output>}
      {save.isError && (
        <p role="alert" className="m-0">
          {save.error instanceof ApiError && save.error.status === 400
            ? "Check your profile"
            : "Couldn’t save profile"}
        </p>
      )}
    </form>
  );
}

export const weightRanges = [
  ["1M", 30],
  ["3M", 91],
  ["6M", 182],
  ["1Y", 365],
  ["All", null],
] as const;
export type WeightRange = (typeof weightRanges)[number][0];

/** The days within the range, counted back from the latest day so a pause in weigh-ins still shows data. */
function daysInRange(history: WeightHistory, range: WeightRange) {
  const length = weightRanges.find(([name]) => name === range)?.[1] ?? null;
  const last = history.days.at(-1);
  if (length === null || !last) return history.days;
  const start = dayTime(last.day) - (length - 1) * 86_400_000;
  return history.days.filter((entry) => dayTime(entry.day) >= start);
}

type WeighIn = WeightHistory["days"][number] & { reading_kg: number };
const hasReading = (entry: WeightHistory["days"][number]): entry is WeighIn =>
  entry.reading_kg !== null;

export function WeightChart({
  person,
  online,
  entry,
}: {
  person: number;
  online: boolean;
  entry?: ReactNode;
}) {
  const [range, setRange] = useState<WeightRange>("3M");
  const history = useQuery({
    queryKey: historyKey(person),
    queryFn: ({ signal }) => readHistory(signal),
    enabled: online,
  });
  const days = useMemo(
    () => (history.data ? daysInRange(history.data, range) : []),
    [history.data, range],
  );
  const chart = useMemo(() => chartData({ days }), [days]);
  const firstDay = days[0]?.day;
  const weighIns =
    history.data?.readings.filter(
      (reading) => firstDay && reading.day >= firstDay,
    ) ?? [];
  const latest = history.data?.days.findLast(hasReading);
  const trend = history.data?.days.at(-1)?.trend_kg;
  return (
    <section
      aria-label="Weight trend"
      className="grid grid-cols-[minmax(0,1fr)] gap-3 p-0"
    >
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className={sectionHead}>Weight</h2>
        <span className={hint}>kg</span>
      </div>
      {history.isError && (
        <p role="alert" className="m-0">
          Couldn’t load weights
        </p>
      )}
      {!history.data ? (
        history.isError ? null : online ? (
          <Skeleton label="Loading weights" className="h-[28.75rem]" />
        ) : (
          <p className={cn(hint, "m-0")}>Unavailable offline</p>
        )
      ) : latest === undefined || trend === undefined ? (
        <p className={cn(hint, "m-0")}>No weigh-ins yet</p>
      ) : (
        <>
          <div className="flex items-baseline gap-6">
            <Metric
              value={displayNumber(latest.reading_kg)}
              unit="kg"
              label={`Weigh-in, ${shortDate(latest.day)}`}
            />
            <Metric
              value={displayNumber(trend)}
              unit="kg"
              label="Trend"
              secondary
            />
          </div>
          <RangePicker range={range} choose={setRange} />
          <Plot data={chart} series={weightSeries} />
          <div className="flex gap-4.5 text-sm text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block h-0.5 w-4.5 bg-accent" />
              Trend
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="inline-block size-1.5 rounded-full bg-ink" />
              Weigh-ins
            </span>
          </div>
        </>
      )}
      <div>
        {weighIns.length > 0 && (
          <Disclosure summary="Weigh-ins">
            <ul className="m-0 list-none p-0">
              {weighIns.toReversed().map((weighIn) => (
                <li key={weighIn.id} className={row}>
                  <div className="min-w-0">
                    <span className="numeric font-medium">
                      {displayNumber(weighIn.weight_kg)} kg
                    </span>
                    {weighIn.note && (
                      <p
                        className={cn(
                          hint,
                          "m-0 whitespace-pre-wrap wrap-anywhere",
                        )}
                      >
                        {weighIn.note}
                      </p>
                    )}
                  </div>
                  <span className={hint}>{shortDate(weighIn.day)}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {entry && (
          <Disclosure summary="Enter weight manually">{entry}</Disclosure>
        )}
      </div>
    </section>
  );
}

function RangePicker({
  range,
  choose,
}: {
  range: WeightRange;
  choose: (range: WeightRange) => void;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 gap-1 rounded-(--radius) border-0 bg-bg-sunk p-0.75">
      <legend className="sr-only">Range</legend>
      {weightRanges.map(([name]) => (
        <button
          key={name}
          type="button"
          data-slot="range"
          aria-pressed={range === name}
          onClick={() => choose(name)}
          className={cn(
            press,
            "numeric min-h-9 flex-1 cursor-pointer rounded-(--radius-md) border border-transparent text-sm text-ink-2 hover:text-ink pointer-coarse:min-h-11",
            "aria-pressed:border-border-strong aria-pressed:bg-bg aria-pressed:text-ink",
          )}
        >
          {name}
        </button>
      ))}
    </fieldset>
  );
}

export function Metric({
  value,
  unit,
  label,
  secondary = false,
}: {
  value: string;
  unit: string;
  label: string;
  secondary?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span
        className={cn(
          "numeric leading-[1.1] tracking-tight",
          secondary ? "text-2xl" : "text-[2rem] font-medium",
        )}
      >
        {value}{" "}
        <small className="text-(length:--step-1) font-normal tracking-normal text-ink-2">
          {unit}
        </small>
      </span>
      <span className={hint}>{label}</span>
    </div>
  );
}

export function WeightForm({
  person,
  replay,
}: {
  person: Session["user"];
  replay: OutboxReplay;
}) {
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      await enqueueWeight(replay, person, weight, note);
    },
    onSuccess: () => {
      setWeight("");
      setNote("");
    },
  });
  return (
    <form
      className="max-w-none gap-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="weight" className="text-ink">
        Weight (kg)
      </label>
      <input
        id="weight"
        type="number"
        inputMode="decimal"
        min="0.01"
        step="any"
        required
        className="m-0"
        value={weight}
        onChange={(event) => setWeight(event.target.value)}
        disabled={save.isPending}
      />
      <label htmlFor="weight-note" className="text-ink">
        Note (optional)
      </label>
      <input
        id="weight-note"
        className="m-0"
        maxLength={200}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={save.isPending}
      />
      <Button
        type="submit"
        variant="secondary"
        className={cn(press, "w-full")}
        disabled={save.isPending}
      >
        Log weight
      </Button>
      {save.isError && (
        <p role="alert" className="m-0">
          Couldn’t save weight
        </p>
      )}
    </form>
  );
}

export function Skeleton({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <div aria-busy="true" className="grid">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className={cn(
          "rounded-(--radius) bg-bg-sunk motion-safe:animate-pulse",
          className,
        )}
      />
    </div>
  );
}

const dayTime = (day: string) => Date.parse(`${day}T12:00:00Z`);
const signed = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
export function shortDate(day: string) {
  const time = dayTime(day);
  if (Number.isNaN(time)) return day;
  return new Date(time).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
function longDate(day: string) {
  const time = dayTime(day);
  if (Number.isNaN(time)) return day;
  return new Date(time).toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Reads a color token when uPlot draws, so the canvas follows light and dark. */
export const themeColor = (name: string) => () =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Calls onChange when the system color scheme or the root data-theme changes; returns a stop function. */
export function watchColorScheme(
  view: typeof globalThis,
  onChange: () => void,
) {
  const media = view.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  const observer = new view.MutationObserver(onChange);
  observer.observe(view.document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

const axis = {
  stroke: themeColor("--color-ink-2"),
  font: '11px "IBM Plex Mono", ui-monospace, monospace',
  grid: { stroke: themeColor("--color-border") },
  ticks: { stroke: themeColor("--color-border") },
};

const weightSeries: Series[] = [
  {},
  {
    label: "Reading",
    stroke: themeColor("--color-ink"),
    paths: () => null,
    points: { show: true, size: 7, fill: themeColor("--color-ink") },
  },
  {
    label: "Trend",
    stroke: themeColor("--color-accent"),
    width: 2,
    spanGaps: true,
  },
];

const noLegend: Legend = { show: false };

export function Plot({
  data,
  series,
  legend = noLegend,
}: {
  data: AlignedData;
  series: Series[];
  legend?: Legend;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let plot: import("uplot") | undefined;
    let active = true;
    let stopWatching: (() => void) | undefined;
    const resize = new ResizeObserver(() =>
      plot?.setSize({ width: element.clientWidth, height: 240 }),
    );
    resize.observe(element);
    // Loaded on demand so uPlot stays out of the first screen's bundle.
    void Promise.all([import("uplot"), import("uplot/dist/uPlot.min.css")])
      .then(([{ default: UPlot }]) => {
        if (!active) return;
        const draw = () =>
          new UPlot(
            {
              width: element.clientWidth,
              height: 240,
              legend,
              series,
              axes: [{ ...axis, grid: { show: false } }, axis],
            },
            data,
            element,
          );
        plot = draw();
        // uPlot fixes its colors when it builds, so a scheme change rebuilds the chart.
        stopWatching = watchColorScheme(globalThis, () => {
          plot?.destroy();
          plot = draw();
        });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      resize.disconnect();
      stopWatching?.();
      plot?.destroy();
    };
  }, [data, series, legend]);
  return failed ? (
    <p role="alert">Couldn’t load chart</p>
  ) : (
    <div className="weight-chart" ref={container} />
  );
}
