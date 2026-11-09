import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AlignedData, Legend, Series } from "uplot";
import { ApiError } from "./api.ts";
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
} from "./profile-api.ts";
import {
  bonusLines,
  displayNumber,
  refreshToday,
  type TodayData,
  totalText,
} from "./today-api.ts";

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

export function ProfileSection({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const profile = useQuery({
    queryKey: profileKey(person),
    queryFn: ({ signal }) => readProfile(signal),
    enabled: online,
  });
  return (
    <section aria-label="Profile">
      <h2>Profile</h2>
      {profile.isError && <p role="alert">Couldn’t load profile</p>}
      {profile.data !== undefined && (
        <ProfileForm person={person} profile={profile.data} online={online} />
      )}
    </section>
  );
}

export function ProfileForm({
  person,
  profile,
  online,
}: {
  person: number;
  profile: Profile | null;
  online: boolean;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState(() => profileValues(profile));
  const save = useMutation({
    mutationFn: () => saveProfile(values),
    onSuccess: async (saved) => {
      client.setQueryData(profileKey(person), saved);
      await refreshToday(client, person);
    },
  });
  const field = (key: keyof typeof values) => ({
    id: `profile-${key}`,
    value: values[key],
    required: true,
    onChange: (event: { target: { value: string } }) => {
      save.reset();
      setValues({ ...values, [key]: event.target.value });
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={!online || save.isPending}>
        <label htmlFor="profile-height_cm">Height (cm)</label>
        <input
          type="number"
          min="100"
          max="250"
          step="any"
          {...field("height_cm")}
        />
        <label htmlFor="profile-birth_date">Birth date</label>
        <input type="date" {...field("birth_date")} />
        <label htmlFor="profile-sex">Sex</label>
        <select {...field("sex")}>
          {profile === null && (
            <option value="" disabled>
              Choose
            </option>
          )}
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
        <label htmlFor="profile-activity_level">Activity level</label>
        <select {...field("activity_level")}>
          {Object.entries(activityLevels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="profile-goal_rate_kg_week">Goal rate (kg/week)</label>
        <input
          type="number"
          min="-1.5"
          max="1"
          step="any"
          {...field("goal_rate_kg_week")}
        />
        <label htmlFor="profile-protein_factor">Protein (g/kg)</label>
        <input
          type="number"
          min="0.8"
          max="3"
          step="any"
          {...field("protein_factor")}
        />
        <button type="submit">
          {save.isPending ? "Saving..." : "Save profile"}
        </button>
      </fieldset>
      {save.isSuccess && <output>Saved</output>}
      {save.isError && (
        <p role="alert">
          {save.error instanceof ApiError && save.error.status === 400
            ? "Check your profile"
            : "Couldn’t save profile"}
        </p>
      )}
    </form>
  );
}

export function WeightChart({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const history = useQuery({
    queryKey: historyKey(person),
    queryFn: ({ signal }) => readHistory(signal),
    select: chartData,
    enabled: online,
  });
  return (
    <section aria-label="Weight trend">
      <h2>Weight</h2>
      {history.isError && <p role="alert">Couldn’t load weights</p>}
      {history.data &&
        (history.data[0].length === 0 ? (
          <p>No weigh-ins yet</p>
        ) : (
          <Plot data={history.data} series={weightSeries} />
        ))}
    </section>
  );
}

const weightSeries: Series[] = [
  {},
  {
    label: "Reading",
    stroke: "#8a8f86",
    paths: () => null,
    points: { show: true, size: 6, fill: "#8a8f86" },
  },
  { label: "Trend", stroke: "#234b40", width: 2, spanGaps: true },
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
    const resize = new ResizeObserver(() =>
      plot?.setSize({ width: element.clientWidth, height: 240 }),
    );
    resize.observe(element);
    // Loaded on demand so uPlot stays out of the first screen's bundle.
    void Promise.all([import("uplot"), import("uplot/dist/uPlot.min.css")])
      .then(([{ default: UPlot }]) => {
        if (!active) return;
        plot = new UPlot(
          {
            width: element.clientWidth,
            height: 240,
            legend,
            series,
          },
          data,
          element,
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      resize.disconnect();
      plot?.destroy();
    };
  }, [data, series, legend]);
  return failed ? (
    <p role="alert">Couldn’t load chart</p>
  ) : (
    <div className="weight-chart" ref={container} />
  );
}
