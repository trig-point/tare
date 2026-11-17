import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  type RouterHistory,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import {
  CircleHelp,
  type LucideIcon,
  Package,
  Plus,
  Sun,
  User,
} from "lucide-react";
import type { ReactNode } from "react";

const tabs: { path: string; label: string; icon: LucideIcon }[] = [
  { path: "/", label: "Today", icon: Sun },
  { path: "/questions", label: "Questions", icon: CircleHelp },
  { path: "/add", label: "Add food", icon: Plus },
  { path: "/pantry", label: "Pantry", icon: Package },
  { path: "/you", label: "You", icon: User },
];
const screenPaths = [...tabs.map((tab) => tab.path), "/settings"];

export function createAppRouter(
  layout: () => ReactNode,
  screens: Record<string, () => ReactNode>,
  history?: RouterHistory,
) {
  const root = createRootRoute({ component: layout });
  const routes = screenPaths.map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: screens[path],
      // The Oura callback returns to /?oura=<result>, which only Settings reads.
      beforeLoad: ({ location }) => {
        if (path === "/" && "oura" in location.search)
          throw redirect({
            to: "/settings",
            search: location.search,
            replace: true,
          });
      },
    }),
  );
  const unknown = createRoute({
    getParentRoute: () => root,
    path: "$",
    beforeLoad: () => {
      throw redirect({ to: "/", replace: true });
    },
  });
  return createRouter({
    routeTree: root.addChildren([...routes, unknown]),
    history,
    scrollRestoration: true,
    // Keyed by path so each tab keeps its own scroll position, not only on back.
    getScrollRestorationKey: (location) => location.pathname,
  });
}

export function BottomNav({ questions }: { questions: number | undefined }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const selected = pathname === "/settings" ? "/you" : pathname;
  return (
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map(({ path, label, icon: Icon }) => (
        <Link
          key={path}
          to={path}
          data-selected={path === selected}
          aria-current={path === selected ? "page" : undefined}
          aria-label={
            path === "/questions" && questions
              ? `${label}, ${questions} open`
              : undefined
          }
          className={path === "/add" ? "nav-add" : undefined}
        >
          <span className="nav-icon" aria-hidden="true">
            <Icon size={22} strokeWidth={1.75} />
          </span>
          {path === "/questions" && questions ? (
            <span className="nav-badge">{questions}</span>
          ) : null}
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
