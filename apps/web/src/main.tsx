import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import {
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { ChevronLeft, MessageCircle, Settings } from "lucide-react";
import {
  createContext,
  type FormEvent,
  useContext,
  useEffect,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AddFood } from "./add-food.tsx";
import { ApiError, type Session } from "./api.ts";
import { BodyFatCard } from "./body-fat.tsx";
import { BottomNav, createAppRouter } from "./nav.tsx";
import { RejectedEntries } from "./outbox-editor.tsx";
import { browserOnline } from "./outbox-http.ts";
import { OutboxReplay, type QueueSnapshot } from "./outbox-replay.ts";
import { OutboxSession } from "./outbox-session.ts";
import { openOutboxStore, type QueueEntry } from "./outbox-store.ts";
import { outboxView } from "./outbox-view.ts";
import { PantrySection } from "./pantry.tsx";
import { ProfileSection, WeightChart } from "./profile.tsx";
import { Questions } from "./questions.tsx";
import { questionsKey, readQuestions } from "./questions-api.ts";
import { AccountSettings } from "./settings.tsx";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./shared/ui/index.ts";
import { Today, useSettledRefresh, WeightForm } from "./today.tsx";
import { UpdateNotice } from "./update-notice.tsx";
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
type App = {
  runtime: Runtime;
  session: Session;
  records: QueueEntry[];
  online: boolean;
};
const appContext = createContext<App | null>(null);
function useApp() {
  const app = useContext(appContext);
  if (!app) throw new Error("Session missing");
  return app;
}
function App() {
  const [attempt, setAttempt] = useState(0);
  return (
    <main>
      <header className="topbar">
        <span className="brand">
          <span className="mark" aria-hidden="true">
            t
          </span>
          Tare
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* aria-disabled rather than disabled keeps the button focusable, so its tooltip is reachable. */}
            <Button
              variant="ghost"
              size="icon"
              aria-disabled="true"
              aria-label="Chat"
              className="chat-entry"
            >
              <MessageCircle />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Chat is coming</TooltipContent>
        </Tooltip>
      </header>
      <UpdateNotice />
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
        <SessionHome runtime={runtime} />
      ) : (
        <output>Loading...</output>
      )}
    </>
  );
}
function SessionHome({ runtime }: { runtime: Runtime }) {
  const session = useQuery(runtime.sessions.query());
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [online, setOnline] = useState(browserOnline);
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
      {view.screen === "offline" && <p>You’re offline.</p>}
      {view.screen === "outage" && (
        <>
          <p>Couldn’t connect</p>
          <button type="button" onClick={() => void session.refetch()}>
            Try again
          </button>
        </>
      )}
      {view.screen === "signed_out" && <SignIn sessions={runtime.sessions} />}
      {view.screen === "app" && view.session && (
        <appContext.Provider
          value={{
            runtime,
            session: view.session,
            records: view.records,
            online,
          }}
        >
          <TabShell />
        </appContext.Provider>
      )}
      <RejectedEntries entries={view.records} replay={runtime.queue} />
    </section>
  );
}

function TabShell() {
  const { runtime, session, records, online } = useApp();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  useSettledRefresh(session.user.id, runtime.queue, records);
  const questions = useQuery({
    queryKey: questionsKey(session.user.id),
    queryFn: ({ signal }) => readQuestions(signal),
    enabled: online,
  });
  return (
    <>
      <div className="screen" key={`${session.user.id}${pathname}`}>
        <Outlet />
      </div>
      <BottomNav questions={questions.data?.length} />
    </>
  );
}

function TodayScreen() {
  const { session, records, online } = useApp();
  return <Today person={session.user} records={records} online={online} />;
}
function QuestionsScreen() {
  const { session, online } = useApp();
  return <Questions person={session.user.id} online={online} />;
}
function AddFoodScreen() {
  const { runtime, session, online } = useApp();
  return (
    <AddFood person={session.user} replay={runtime.queue} online={online} />
  );
}
function PantryScreen() {
  const { session, online } = useApp();
  return <PantrySection person={session.user.id} online={online} />;
}
function YouScreen() {
  const { runtime, session, online } = useApp();
  return (
    <section aria-label="You">
      <div className="page-head">
        <h1>You</h1>
        <Link to="/settings" className="button">
          <Settings aria-hidden="true" size={16} />
          Settings
        </Link>
      </div>
      <WeightForm person={session.user} replay={runtime.queue} />
      <WeightChart person={session.user.id} online={online} />
      <BodyFatCard person={session.user.id} online={online} />
      <ProfileSection person={session.user.id} online={online} />
    </section>
  );
}
function SettingsScreen() {
  const { runtime, session, online } = useApp();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => runtime.sessions.signOut(session),
    // Access sign-out leaves the page for the logout URL; a router replace could cancel that.
    onSuccess: () => {
      if (session.mode === "fallback")
        void navigate({ to: "/", replace: true });
    },
  });
  return (
    <>
      <Link to="/you" className="back-link" aria-label="Back to You">
        <ChevronLeft aria-hidden="true" size={18} />
        You
      </Link>
      <AccountSettings session={session} online={online} />
      <button
        type="button"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        {signOut.isPending ? "Signing out..." : "Sign out"}
      </button>
      {signOut.isError && <p role="alert">Couldn’t sign out. Try again.</p>}
    </>
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

const router = createAppRouter(App, {
  "/": TodayScreen,
  "/questions": QuestionsScreen,
  "/add": AddFoodScreen,
  "/pantry": PantryScreen,
  "/you": YouScreen,
  "/settings": SettingsScreen,
});
const container = document.getElementById("root");
if (!container) throw new Error("App root missing");
createRoot(container).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
