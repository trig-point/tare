import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ApiError,
  api,
  endSession,
  readSession,
  signOutTarget,
} from "./api.ts";
import "./style.css";

const sessionKey = ["session"];

function App() {
  return (
    <main>
      <header className="brand">
        <span className="mark" aria-hidden="true">
          t
        </span>
        Tare
      </header>
      <Outlet />
      <footer>A little more balance, every day.</footer>
    </main>
  );
}

function Home() {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: readSession,
    retry: false,
  });
  const signOut = useMutation({
    mutationFn: endSession,
    onSuccess: () => {
      client.setQueryData(sessionKey, null);
    },
  });
  if (session.isPending) return <output>Loading...</output>;
  if (session.isError)
    return (
      <section>
        <h1>Couldn’t load your account</h1>
        <button type="button" onClick={() => session.refetch()}>
          Try again
        </button>
      </section>
    );
  if (session.data === null) return <SignIn />;
  const target = signOutTarget(session.data);
  return (
    <section>
      <p className="eyebrow">YOUR EVERYDAY COMPANION</p>
      <h1>Hello, {session.data.user.username}.</h1>
      <p className="description">A fresh space for your daily habits.</p>
      {"href" in target ? (
        <a className="button" href={target.href}>
          Sign out
        </a>
      ) : (
        <button
          type="button"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate(target)}
        >
          {signOut.isPending ? "Signing out..." : "Sign out"}
        </button>
      )}
      {signOut.isError && <p role="alert">Couldn’t sign out. Try again.</p>}
    </section>
  );
}

function SignIn() {
  const client = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: async () => {
      await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const session = await readSession();
      if (session === null) throw new Error("Session missing");
      return session;
    },
    onSuccess: (session) => {
      setPassword("");
      client.setQueryData(sessionKey, session);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    signIn.mutate();
  }
  return (
    <section>
      <p className="eyebrow">WELCOME TO TARE</p>
      <h1>Make room for you.</h1>
      <p className="description">Sign in to your daily space.</p>
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
  <QueryClientProvider client={new QueryClient()}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
