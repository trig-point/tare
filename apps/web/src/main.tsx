import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  createContext,
  type FormEvent,
  useContext,
  useEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "./api.ts";
import { RejectedEntries } from "./outbox-editor.tsx";
import { browserOnline } from "./outbox-http.ts";
import { OutboxReplay, type QueueSnapshot } from "./outbox-replay.ts";
import { OutboxSession } from "./outbox-session.ts";
import { openOutboxStore } from "./outbox-store.ts";
import { outboxView } from "./outbox-view.ts";
import "./style.css";

const client = new QueryClient();
async function openRuntime() {
  const store = await openOutboxStore();
  const sessions = new OutboxSession(store, client);
  const queue = new OutboxReplay({
    store,
    onSession: async (outcome, version) => {
      await sessions.accept(outcome, version);
    },
    onIdentityRefused: () => sessions.identityRefused(),
  });
  sessions.wake = () => {
    void queue.wake();
  };
  return { store, sessions, queue };
}
type Runtime = Awaited<ReturnType<typeof openRuntime>>;
const runtimeContext = createContext<Runtime | null>(null);
function App() {
  const [attempt, setAttempt] = useState(0);
  return (
    <main>
      <header className="brand">
        <span className="mark" aria-hidden="true">
          t
        </span>
        Tare
      </header>
      <RuntimeShell key={attempt} retry={() => setAttempt(attempt + 1)} />
    </main>
  );
}
function RuntimeShell({ retry }: { retry: () => void }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let opened: Runtime | null = null;
    setRuntime(null);
    setFailed(false);
    void openRuntime()
      .then(async (value) => {
        opened = value;
        if (active) {
          setRuntime(value);
          await value.queue.start();
        } else {
          await value.queue.close();
          value.store.close();
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (opened) {
        const value = opened;
        void value.queue
          .close()
          .catch(() => console.error("Outbox close failed"))
          .finally(() => value.store.close());
      }
    };
  }, []);
  return (
    <>
      {failed ? (
        <section>
          <p role="alert">Storage unavailable</p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </section>
      ) : runtime ? (
        <runtimeContext.Provider value={runtime}>
          <Outlet />
        </runtimeContext.Provider>
      ) : (
        <output>Loading...</output>
      )}
    </>
  );
}
function Home() {
  const runtime = useContext(runtimeContext);
  if (!runtime) throw new Error("Outbox unavailable");
  return <SessionHome runtime={runtime} />;
}
function SessionHome({ runtime }: { runtime: Runtime }) {
  const session = useQuery(runtime.sessions.query());
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [online, setOnline] = useState(browserOnline);
  const signOut = useMutation({
    mutationFn: () => {
      if (!view.session) throw new Error("Session missing");
      return runtime.sessions.signOut(view.session);
    },
  });
  useEffect(() => {
    const unsubscribe = runtime.queue.subscribe(setQueue);
    const connection = () => setOnline(browserOnline());
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      unsubscribe();
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [runtime]);
  const view = outboxView(session.data, queue, online, session.isError);
  return (
    <section>
      <output className="queue-status">
        {view.status}
        {view.pending > 0 && view.status !== `${view.pending} pending` && (
          <span>{view.pending} pending</span>
        )}
        {view.rejected > 0 && view.status !== `${view.rejected} rejected` && (
          <span>{view.rejected} rejected</span>
        )}
        {view.signIn && <a href="/api/sign-in">Sign in</a>}
      </output>
      {view.storageWarning && <p>Storage may be cleared</p>}
      {view.screen === "loading" && <output>Loading...</output>}
      {view.screen === "offline" && <p>You're offline.</p>}
      {view.screen === "outage" && (
        <>
          <p>Couldn’t connect</p>
          <button type="button" onClick={() => void session.refetch()}>
            Try again
          </button>
        </>
      )}
      {view.screen === "sign_in_needed" && !view.signIn && (
        <a className="button" href="/api/sign-in">
          Sign in
        </a>
      )}
      {view.screen === "signed_out" && <SignIn sessions={runtime.sessions} />}
      {view.screen === "app" && view.session && (
        <>
          <h1>Hello, {view.session.user.username}.</h1>
          <button
            type="button"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            {signOut.isPending ? "Signing out..." : "Sign out"}
          </button>
          {signOut.isError && <p role="alert">Couldn’t sign out. Try again.</p>}
        </>
      )}
      <RejectedEntries entries={view.records} replay={runtime.queue} />
    </section>
  );
}

function SignIn({ sessions }: { sessions: OutboxSession }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: () => sessions.signIn(username, password),
    onSuccess: () => setPassword(""),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate();
  }
  return (
    <section>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          maxLength={64}
          disabled={signIn.isPending}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          maxLength={1024}
          disabled={signIn.isPending}
        />
        {signIn.isError && (
          <p role="alert">
            {signIn.error instanceof ApiError && signIn.error.status === 401
              ? "Check your username and password."
              : "Couldn’t sign in. Try again."}
          </p>
        )}
        <button disabled={signIn.isPending} type="submit">
          {signIn.isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}

const rootRoute = createRootRoute({ component: App });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});
const deepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  component: Home,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, deepRoute]),
});
const container = document.getElementById("root");
if (!container) throw new Error("App root missing");
createRoot(container).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
