import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError, type Session } from "./api.ts";
import { refreshDays } from "./days-api.ts";
import { ConnectedSources } from "./health.tsx";
import { ouraKey, readOura } from "./health-api.ts";
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
import { Button, cn } from "./shared/ui/index.ts";
import { refreshToday } from "./today-api.ts";
import "./settings.css";

const hours = Array.from({ length: 24 }, (_unused, hour) => hour);
const hourLabel = (hour: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "AM" : "PM"}`;
const failure = (error: unknown) =>
  error instanceof ApiError && error.status === 409
    ? "Already in use"
    : error instanceof ApiError && error.status === 400
      ? "Check the details"
      : "Couldn’t save. Try again.";

const press =
  "transition-transform duration-(--motion-press) ease-move active:scale-[0.97]";
const hint = "m-0 text-sm text-ink-2";
const heading = "m-0 text-(length:--step-2) font-semibold tracking-tight";
const row =
  "flex min-h-16 items-center gap-3 border-b border-border py-3 [overflow-wrap:anywhere]";
const quietDanger = cn(
  press,
  "min-h-11 px-3 text-needs-human hover:bg-bg-sunk hover:text-needs-human",
);

export function AccountSettings({
  session,
  online,
  signOut,
}: {
  session: Session;
  online: boolean;
  signOut?: ReactNode;
}) {
  const account = useQuery({
    queryKey: accountKey(session.user.id),
    queryFn: ({ signal }) => readAccount(signal),
    enabled: online,
  });
  const loading = !account.data && !account.isError && online;
  return (
    <section id="settings" aria-label="Settings" className="settings-screen">
      <div className="settings-head">
        <h1>Settings</h1>
        <p className={hint}>Account and connections</p>
      </div>
      {account.isError && <p role="alert">Couldn’t load settings</p>}
      {!account.data && !account.isError && !online && (
        <p className={hint}>Settings unavailable offline</p>
      )}
      <div className="settings-grid">
        <div className="settings-column">
          {loading && <Skeleton label="Loading settings" className="h-72" />}
          {account.data && (
            <DayBoundaryForm account={account.data} online={online} />
          )}
          {signOut}
        </div>
        {(loading || account.data) && (
          <div className="settings-column">
            {loading && (
              <>
                <Skeleton label="Loading sources" className="h-20" />
                {session.mode === "access" && <AgentsPlaceholder />}
              </>
            )}
            {account.data && (
              <>
                <Sources account={account.data} online={online} />
                {session.mode === "access" && (
                  <AgentMappings account={account.data} online={online} />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Sources({ account, online }: { account: Account; online: boolean }) {
  // Shares ConnectedSources' query; both stay mounted so a failed read cannot remount and refetch.
  const oura = useQuery({
    queryKey: ouraKey(account.id),
    queryFn: ({ signal }) => readOura(signal),
    enabled: online,
  });
  return (
    <>
      {oura.isPending && online && (
        <Skeleton label="Loading sources" className="h-20" />
      )}
      <ConnectedSources
        person={account.id}
        timezone={account.timezone}
        online={online}
        callbackResult={new URLSearchParams(globalThis.location?.search).get(
          "oura",
        )}
      />
    </>
  );
}

function AgentsPlaceholder() {
  return (
    <div className="grid gap-1">
      <h2 className={heading}>Agents</h2>
      <Skeleton label="Loading agents" className="h-32" />
    </div>
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
    <form
      aria-label="Day boundary"
      onSubmit={submit}
      className="settings-day grid max-w-none gap-4"
    >
      <h2 className={heading}>Your day</h2>
      <div className="grid gap-1.5">
        <label htmlFor="settings-timezone">Timezone</label>
        <select
          id="settings-timezone"
          className="m-0 min-h-11"
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
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="settings-day-start">Day starts at</label>
        <select
          id="settings-day-start"
          className="m-0 min-h-11"
          value={hour}
          onChange={(event) => {
            save.reset();
            setHour(event.target.value);
          }}
        >
          {hours.map((value) => (
            <option key={value} value={value}>
              {hourLabel(value)}
            </option>
          ))}
        </select>
        <p className={cn(hint, "text-(length:--step--1)")}>
          Applies to new entries
        </p>
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-3">
        <Button
          type="submit"
          className={cn(press, "min-h-11 px-5")}
          disabled={!online || save.isPending}
        >
          {save.isPending ? "Saving..." : "Save"}
        </Button>
        {save.isSuccess && <output className="text-sm text-ok">Saved</output>}
        {save.isError && (
          <p role="alert" className="m-0 text-sm">
            {failure(save.error)}
          </p>
        )}
      </div>
    </form>
  );
}

export function AccountRow({
  session,
  pending,
  onSignOut,
}: {
  session: Session;
  pending: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="settings-account flex items-center gap-3 border-t border-border pt-5">
      <div className="grid min-w-0 flex-1 gap-0.5 [overflow-wrap:anywhere]">
        <strong className="font-medium">{session.user.username}</strong>
        <span className={hint}>
          {session.mode === "access" ? "Cloudflare Access" : "Password sign-in"}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        className={quietDanger}
        disabled={pending}
        onClick={onSignOut}
      >
        {pending ? "Signing out..." : "Sign out"}
      </Button>
    </div>
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
    <section aria-label="Agents" className="grid gap-1 p-0">
      <h2 className={cn(heading, "flex items-center justify-between gap-3")}>
        Agents
        {mappings.data && mappings.data.length > 0 && (
          <span className="numeric rounded-(--radius) bg-bg-sunk px-1.5 text-sm font-normal text-ink-2">
            {mappings.data.length}
          </span>
        )}
      </h2>
      {mappings.isError && <p role="alert">Couldn’t load agents</p>}
      {mappings.isPending && online && (
        <Skeleton label="Loading agents" className="h-32" />
      )}
      {mappings.isPending && !online && (
        <p className={hint}>Unavailable offline</p>
      )}
      {mappings.data && (
        <MappingList
          person={account.id}
          timezone={account.timezone}
          mappings={mappings.data}
          online={online}
        />
      )}
      {account.is_admin && (
        <MapClientIdForm key={account.id} person={account.id} online={online} />
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
  if (mappings.length === 0)
    return <p className={cn(hint, "py-3")}>No agents</p>;
  return (
    <>
      <ul className="m-0 list-none p-0">
        {mappings.map((mapping) => (
          <li key={mapping.id} className={row}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <strong className="font-medium">{mapping.name}</strong>
              {mapping.last_used_at === null ? (
                <span className={hint}>Never used</span>
              ) : (
                <span className={hint}>
                  Last used{" "}
                  <time dateTime={mapping.last_used_at}>
                    {new Date(mapping.last_used_at).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: timezone,
                    })}
                  </time>
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              className={quietDanger}
              aria-label={`Remove ${mapping.name}`}
              disabled={!online || remove.isPending}
              onClick={() => remove.mutate(mapping.id)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert">Couldn’t remove. Try again.</p>}
    </>
  );
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

function MapClientIdForm({
  person,
  online,
}: {
  person: number;
  online: boolean;
}) {
  const client = useQueryClient();
  const empty = { client_id: "", name: "" };
  const [values, setValues] = useState(empty);
  const map = useMutation({
    mutationFn: () => mapClientId({ ...values, user_id: String(person) }),
    onSuccess: async () => {
      setValues(empty);
      const queryKey = mappingsKey(person);
      await client.cancelQueries({ queryKey, exact: true });
      await client.invalidateQueries({ queryKey, exact: true });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !online ||
      map.isPending ||
      !values.client_id.trim() ||
      !values.name.trim()
    )
      return;
    map.mutate();
  }
  const duplicate =
    map.error instanceof ApiError &&
    map.error.status === 409 &&
    map.error.code === "client_id_taken";
  const fields = [
    ["client_id", "Client ID", 256],
    ["name", "Name", 64],
  ] as const;
  return (
    <form
      aria-labelledby="add-agent-heading"
      onSubmit={submit}
      className="mt-4 grid gap-3"
    >
      <h3 id="add-agent-heading" className="m-0 font-semibold">
        Add an agent
      </h3>
      {fields.map(([key, label, limit]) => (
        <div key={key} className="grid gap-1.5">
          <label htmlFor={`map-${key}`}>{label}</label>
          <input
            id={`map-${key}`}
            className="m-0 min-h-11"
            value={values[key]}
            onChange={(event) => {
              map.reset();
              setValues({ ...values, [key]: event.target.value });
            }}
            required
            maxLength={limit}
            disabled={!online || map.isPending}
          />
        </div>
      ))}
      <Button
        type="submit"
        className={cn(press, "min-h-11 justify-self-start px-5")}
        disabled={
          !online ||
          map.isPending ||
          !values.client_id.trim() ||
          !values.name.trim()
        }
      >
        {map.isPending ? "Adding..." : "Add"}
      </Button>
      {map.isError && (
        <p role="alert">
          {duplicate ? "That Client ID is already added." : failure(map.error)}
        </p>
      )}
    </form>
  );
}
