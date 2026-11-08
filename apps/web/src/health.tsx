import { useMutation, useQuery } from "@tanstack/react-query";
import {
  connectOura,
  metricLabels,
  ouraKey,
  ouraView,
  readOura,
  readSignals,
  signalsKey,
  signalText,
} from "./health-api.ts";
import { displayNumber } from "./today-api.ts";

export function DaySignals({
  person,
  day,
  online,
}: {
  person: number;
  day: string;
  online: boolean;
}) {
  const signals = useQuery({
    queryKey: signalsKey(person, day),
    queryFn: ({ signal }) => readSignals(day, signal),
    enabled: online,
  });
  if (signals.isError) return <p role="alert">Couldn’t load signals</p>;
  if (!signals.data) return null;
  const { signals: rows, activities } = signals.data;
  return (
    <section className="signals" aria-label="Signals">
      {rows.length === 0 && activities.length === 0 ? (
        <p>No signals</p>
      ) : (
        <dl className="totals">
          {rows.map((entry) => (
            <div key={entry.metric}>
              <dt>{metricLabels[entry.metric]}</dt>
              <dd>{signalText(entry)}</dd>
            </div>
          ))}
          {activities.map((activity) => (
            <div key={activity.id}>
              <dt>{activity.kind}</dt>
              <dd>
                {activity.duration_minutes} min
                {activity.calories !== null &&
                  ` · ${displayNumber(activity.calories)} kcal`}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function OuraStatus({
  person,
  timezone,
  online,
  navigate = (url) => window.location.assign(url),
}: {
  person: number;
  timezone: string;
  online: boolean;
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
  if (connection.isError) return <p role="alert">Couldn’t load Oura</p>;
  if (!connection.data) return null;
  const view = ouraView(connection.data);
  if (view.state === "hidden") return null;
  const label =
    view.state === "disconnected" ? "Connect Oura" : "Reconnect Oura";
  return (
    <section className="oura" aria-label="Oura">
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
      {view.state === "authorization" && <p>Oura sign-in expired</p>}
      {view.state === "restored" && (
        <p>Oura needs reconnecting after a restore</p>
      )}
      {(view.state === "disconnected" ||
        view.state === "authorization" ||
        view.state === "restored") && (
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
