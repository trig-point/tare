import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  bodyRows,
  canConnectOura,
  connectOura,
  metricLabels,
  onPageRestored,
  ouraKey,
  ouraView,
  readOura,
  readSignals,
  signalsKey,
  signalText,
  sourceLabel,
} from "./health-api.ts";
import { displayNumber } from "./today-api.ts";

export function BodyCard({
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
  const connection = useQuery({
    queryKey: ouraKey(person),
    queryFn: ({ signal }) => readOura(signal),
    enabled: online,
  });
  if (signals.isError) return <p role="alert">Couldn’t load signals</p>;
  if (!signals.data) return null;
  const rows = bodyRows(signals.data.signals);
  const { activities } = signals.data;
  const canConnect =
    connection.data !== undefined && canConnectOura(ouraView(connection.data));
  return (
    <section className="signals" aria-label="Body">
      <h2>Body</h2>
      {rows.length === 0 && activities.length === 0 ? (
        canConnect ? (
          <p>
            <a href="#settings">Connect a source in Settings</a>
          </p>
        ) : (
          <p>No signals</p>
        )
      ) : (
        <dl className="totals">
          {rows.map((entry) => (
            <div key={`${entry.metric}-${entry.source}`}>
              <dt>{metricLabels[entry.metric]}</dt>
              <dd>{signalText(entry)}</dd>
              <dd className="source">{sourceLabel(entry.source)}</dd>
              {entry.why.map((line) => (
                <dd key={line} className="why">
                  {line}
                </dd>
              ))}
            </div>
          ))}
          {activities.map((activity) => (
            <div key={activity.id}>
              <dt>{activity.kind}</dt>
              <dd>
                {activity.duration_minutes === null
                  ? "Time not recorded"
                  : `${activity.duration_minutes} min`}
                {activity.calories !== null &&
                  ` · ${displayNumber(activity.calories)} kcal`}
              </dd>
              <dd className="source">{sourceLabel(activity.source)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
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
