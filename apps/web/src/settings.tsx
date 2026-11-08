import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, type Session } from "./api.ts";
import { refreshDays } from "./days-api.ts";
import { ConnectedSources } from "./health.tsx";
import {
  type Account,
  accountKey,
  addUser,
  type Mapping,
  mapClientId,
  mappingsKey,
  readAccount,
  readMappings,
  removeMapping,
  saveDaySettings,
  timezones,
} from "./settings-api.ts";
import { refreshToday } from "./today-api.ts";

const hours = Array.from({ length: 24 }, (_unused, hour) => hour);
const failure = (error: unknown) =>
  error instanceof ApiError && error.status === 409
    ? "Already in use"
    : error instanceof ApiError && error.status === 400
      ? "Check the details"
      : "Couldn’t save. Try again.";

export function AccountSettings({
  session,
  online,
}: {
  session: Session;
  online: boolean;
}) {
  const account = useQuery({
    queryKey: accountKey(session.user.id),
    queryFn: ({ signal }) => readAccount(signal),
    enabled: online,
  });
  return (
    <section id="settings" aria-label="Settings">
      <h2>Settings</h2>
      {account.isError && <p role="alert">Couldn’t load settings</p>}
      {!account.data && !account.isError && (
        <p>{online ? "Loading..." : "Settings unavailable offline"}</p>
      )}
      {account.data && (
        <>
          <DayBoundaryForm account={account.data} online={online} />
          <ConnectedSources
            person={account.data.id}
            timezone={account.data.timezone}
            online={online}
            callbackResult={new URLSearchParams(
              globalThis.location?.search,
            ).get("oura")}
          />
          {session.mode === "access" && (
            <AgentMappings account={account.data} online={online} />
          )}
          {account.data.is_admin && session.mode === "access" && (
            <MapClientIdForm person={account.data.id} online={online} />
          )}
        </>
      )}
    </section>
  );
}

export function DayBoundaryForm({
  account,
  online,
}: {
  account: Account;
  online: boolean;
}) {
  const client = useQueryClient();
  const [timezone, setTimezone] = useState(account.timezone);
  const [hour, setHour] = useState(String(account.day_start_hour));
  const save = useMutation({
    mutationFn: () => saveDaySettings(timezone, hour),
    onSuccess: async (saved) => {
      client.setQueryData(accountKey(saved.id), saved);
      await Promise.all([
        refreshToday(client, saved.id),
        refreshDays(client, saved.id),
      ]);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }
  return (
    <form aria-label="Day boundary" onSubmit={submit}>
      <label htmlFor="settings-timezone">Timezone</label>
      <select
        id="settings-timezone"
        value={timezone}
        onChange={(event) => {
          save.reset();
          setTimezone(event.target.value);
        }}
      >
        {timezones(account.timezone).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <label htmlFor="settings-day-start">Day starts at</label>
      <select
        id="settings-day-start"
        value={hour}
        onChange={(event) => {
          save.reset();
          setHour(event.target.value);
        }}
      >
        {hours.map((value) => (
          <option key={value} value={value}>
            {`${String(value).padStart(2, "0")}:00`}
          </option>
        ))}
      </select>
      <p>Applies to new entries</p>
      <button type="submit" disabled={!online || save.isPending}>
        {save.isPending ? "Saving..." : "Save"}
      </button>
      {save.isSuccess && <output>Saved</output>}
      {save.isError && <p role="alert">{failure(save.error)}</p>}
    </form>
  );
}

function AgentMappings({
  account,
  online,
}: {
  account: Account;
  online: boolean;
}) {
  const mappings = useQuery({
    queryKey: mappingsKey(account.id),
    queryFn: ({ signal }) => readMappings(signal),
    enabled: online,
  });
  return (
    <section aria-label="Agents">
      <h3>Agents</h3>
      {mappings.isError && <p role="alert">Couldn’t load agents</p>}
      {mappings.data && (
        <MappingList
          person={account.id}
          timezone={account.timezone}
          mappings={mappings.data}
          online={online}
        />
      )}
    </section>
  );
}

export function MappingList({
  person,
  timezone,
  mappings,
  online,
}: {
  person: number;
  timezone: string;
  mappings: Mapping[];
  online: boolean;
}) {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: removeMapping,
    onSettled: () =>
      client.invalidateQueries({ queryKey: mappingsKey(person) }),
  });
  if (mappings.length === 0) return <p>No agents</p>;
  return (
    <>
      <ul className="entries">
        {mappings.map((mapping) => (
          <li key={mapping.id}>
            <strong>{mapping.name}</strong>{" "}
            {mapping.last_used_at === null ? (
              <span>Never used</span>
            ) : (
              <span>
                Last used{" "}
                <time dateTime={mapping.last_used_at}>
                  {new Date(mapping.last_used_at).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: timezone,
                  })}
                </time>
              </span>
            )}{" "}
            <button
              type="button"
              disabled={!online || remove.isPending}
              onClick={() => remove.mutate(mapping.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert">Couldn’t remove. Try again.</p>}
    </>
  );
}

// Adding users is post-V1 (single person); kept for later, not rendered.
export function AddUserForm({
  mode,
  online,
}: {
  mode: Session["mode"];
  online: boolean;
}) {
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const add = useMutation({
    mutationFn: () =>
      addUser(
        mode === "access"
          ? { username, email: secret }
          : { username, password: secret },
      ),
    onSuccess: () => {
      setUsername("");
      setSecret("");
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    add.mutate();
  }
  return (
    <form aria-label="Add a person" onSubmit={submit}>
      <h3>Add a person</h3>
      <label htmlFor="add-user-username">Username</label>
      <input
        id="add-user-username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        required
        maxLength={64}
      />
      <label htmlFor="add-user-secret">
        {mode === "access" ? "Access email" : "Initial password"}
      </label>
      <input
        id="add-user-secret"
        type={mode === "access" ? "email" : "password"}
        autoComplete={mode === "access" ? "off" : "new-password"}
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        required
        maxLength={mode === "access" ? 320 : 1024}
      />
      <button type="submit" disabled={!online || add.isPending}>
        {add.isPending ? "Adding..." : "Add"}
      </button>
      {add.isSuccess && (
        <output>
          Added {add.data.username}, ID {add.data.id}
        </output>
      )}
      {add.isError && <p role="alert">{failure(add.error)}</p>}
    </form>
  );
}

export function MapClientIdForm({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const client = useQueryClient();
  const empty = { client_id: "", user_id: "", name: "" };
  const [values, setValues] = useState(empty);
  const map = useMutation({
    mutationFn: () => mapClientId(values),
    onSuccess: async () => {
      setValues(empty);
      await client.invalidateQueries({ queryKey: mappingsKey(person) });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    map.mutate();
  }
  const fields = [
    ["client_id", "Client ID", 256],
    ["user_id", "Person ID", 16],
    ["name", "Agent name", 64],
  ] as const;
  return (
    <form aria-label="Map a Client ID" onSubmit={submit}>
      <h3>Map a Client ID</h3>
      {fields.map(([key, label, limit]) => (
        <div key={key}>
          <label htmlFor={`map-${key}`}>{label}</label>
          <input
            id={`map-${key}`}
            inputMode={key === "user_id" ? "numeric" : undefined}
            value={values[key]}
            onChange={(event) =>
              setValues({ ...values, [key]: event.target.value })
            }
            required
            maxLength={limit}
          />
        </div>
      ))}
      <button type="submit" disabled={!online || map.isPending}>
        {map.isPending ? "Mapping..." : "Map"}
      </button>
      {map.isSuccess && <output>Mapped</output>}
      {map.isError && <p role="alert">{failure(map.error)}</p>}
    </form>
  );
}
