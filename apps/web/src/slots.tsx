import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ApiError } from "./api.ts";
import { refreshDays } from "./days-api.ts";
import {
  acceptShares,
  actOnItem,
  type ItemAction,
  type Plan,
  type PlannedItem,
  planKey,
  planQuery,
} from "./plan-api.ts";
import { Button, cn } from "./shared/ui/index.ts";
import { displayNumber, refreshToday } from "./today-api.ts";

const statusText = {
  no_day_type: "No plan for today",
  needs_profile: "Set up your profile to see budgets",
  needs_weigh_in: "Log a weight to see budgets",
};
const actions: [ItemAction, string, "default" | "outline" | "ghost"][] = [
  ["ate", "Ate", "default"],
  ["ate_three_quarters", "Ate 3/4", "outline"],
  ["skip", "Skip", "ghost"],
];
/** Press feedback for buttons on the Today screen. */
export const press =
  "transition-[color,background-color,scale] duration-(--motion-press) ease-move active:scale-[0.97]";

export function Slots({ person, online }: { person: number; online: boolean }) {
  const plan = useQuery({ ...planQuery(person), enabled: online });
  return (
    <SlotList
      person={person}
      plan={plan.data}
      failed={plan.isError}
      online={online}
    />
  );
}

export function SlotList({
  person,
  plan,
  failed,
  online,
}: {
  person: number;
  plan: Plan | undefined;
  failed: boolean;
  online: boolean;
}) {
  const status = plan?.budgets.status;
  // Budget rows come in time order; positions need not.
  const timeOrder = (plan?.budgets.slots ?? []).map((row) => row.position);
  const slots = (plan?.slots ?? [])
    .map((slot) => ({
      slot,
      budget: plan?.budgets.slots.find((row) => row.position === slot.position),
      items: (plan?.planned_items ?? []).filter(
        (item) => item.position === slot.position,
      ),
    }))
    .toSorted(
      (left, right) =>
        timeOrder.indexOf(left.slot.position) -
        timeOrder.indexOf(right.slot.position),
    );
  const next = slots.find((entry) => entry.budget && !entry.budget.ended);
  const later = slots.filter((entry) => entry !== next && !entry.budget?.ended);
  const ended = slots.filter((entry) => entry.budget?.ended);
  return (
    <section
      aria-label="Meals"
      className="contents p-0 md:col-start-2 md:row-span-4 md:row-start-1 md:block"
    >
      <div className="order-2 empty:hidden">
        {failed && <p role="alert">Couldn’t load meals</p>}
        {!plan && !failed && !online && (
          <p className="m-0 text-ink-2">Unavailable offline</p>
        )}
        {!plan && !failed && online && (
          // Sized like a next meal with one planned item.
          <div aria-busy="true" className="h-54 animate-pulse bg-bg-sunk" />
        )}
        {status && status !== "ready" && (
          <p className="m-0 mb-3 text-ink-2">{statusText[status]}</p>
        )}
        {next && <SlotBlock {...next} next person={person} online={online} />}
      </div>
      {plan && (
        <div className="order-4 empty:hidden md:mt-5">
          {later.map((entry) => (
            <div
              key={entry.slot.position}
              className="mb-5 border-t border-border pt-5"
            >
              <SlotBlock {...entry} person={person} online={online} />
            </div>
          ))}
          {ended.map((entry) => (
            <Disclosure
              key={entry.slot.position}
              summary={`${entry.slot.name} · Ended`}
            >
              <SlotBlock {...entry} person={person} online={online} />
            </Disclosure>
          ))}
          <Suggestion person={person} plan={plan} online={online} />
        </div>
      )}
    </section>
  );
}

/** A collapsed section under a rule, opened by its summary row. */
export function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-0 border-b border-border first-of-type:border-t">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-medium [&::-webkit-details-marker]:hidden">
        {summary}
        <Plus
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-3 transition-transform duration-(--motion-tab) ease-move group-open:rotate-45"
        />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

function SlotBlock({
  slot,
  budget,
  items,
  next = false,
  person,
  online,
}: {
  slot: Plan["slots"][number];
  budget: Plan["budgets"]["slots"][number] | undefined;
  items: PlannedItem[];
  next?: boolean;
  person: number;
  online: boolean;
}) {
  const known = budget?.kcal.budget != null && budget.protein_g.budget != null;
  return (
    <div className={cn(next && "border-l-2 border-accent pl-4")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0">{slot.name}</h2>
        {next && <Badge>Next meal</Badge>}
      </div>
      {budget && (
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
          <Figure value={budget.kcal} unit="kcal" />
          <Figure value={budget.protein_g} unit="protein" />
        </div>
      )}
      {next && known && (
        <p className="m-0 mt-2 text-step--1 text-ink-2">
          Budget{" "}
          <span className="numeric">
            {displayNumber(budget.kcal.budget ?? 0)}
          </span>{" "}
          kcal,{" "}
          <span className="numeric">
            {displayNumber(budget.protein_g.budget ?? 0)} g
          </span>{" "}
          protein
        </p>
      )}
      {items.length === 0 && (
        <p className="m-0 mt-3 text-ink-2">Nothing planned</p>
      )}
      {items.map((item) => (
        <ItemRow key={item.id} person={person} item={item} online={online} />
      ))}
    </div>
  );
}

function Badge({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "ok";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-(--radius) bg-bg-sunk px-2 py-0.5 text-step--1",
        tone === "ok" ? "text-ok" : "text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

function Suggestion({
  person,
  plan,
  online,
}: {
  person: number;
  plan: Plan;
  online: boolean;
}) {
  const client = useQueryClient();
  const [ignored, setIgnored] = useState(false);
  const shares = plan.suggested_shares;
  const accept = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (!online || !navigator.onLine || !shares) throw new Error("Offline");
      await acceptShares(plan, shares);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: planKey(person) }),
  });
  const unchanged = plan.slots.every(
    (slot) =>
      shares?.find((value) => value.position === slot.position)?.share ===
      slot.share_bp / 100,
  );
  if (!shares || ignored || unchanged) return null;
  return (
    <Disclosure summary="Suggested meal shares">
      <p className="m-0 text-ink-2">
        {plan.slots
          .map(
            (slot) =>
              `${slot.name} ${shares.find((value) => value.position === slot.position)?.share}%`,
          )
          .join(", ")}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          className={press}
          disabled={!online || accept.isPending}
          onClick={() => accept.mutate()}
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          className={press}
          onClick={() => setIgnored(true)}
        >
          Ignore
        </Button>
      </div>
      {accept.isError && <p role="alert">Couldn’t save shares</p>}
    </Disclosure>
  );
}

function Figure({
  value,
  unit,
}: {
  value: Plan["budgets"]["slots"][number]["kcal"];
  unit: "kcal" | "protein";
}) {
  const suffix = unit === "protein" ? " g" : "";
  if (value.budget === null)
    return (
      <div>
        <strong className="numeric block text-[26px] leading-tight font-normal">
          Unknown
        </strong>
        <span className="text-step--1 text-ink-2">{unit} budget</span>
      </div>
    );
  // The engine leaves remaining null while any entry lacks this nutrient.
  const left = value.remaining ?? value.budget - value.known_subtotal;
  return (
    <div>
      <strong
        className={cn(
          "numeric block text-[28px] leading-tight font-normal",
          left < 0 || !value.complete ? "text-caution" : "text-ok",
        )}
      >
        {`${displayNumber(Math.abs(left))}${suffix}`}
      </strong>
      <span className="text-step--1 text-ink-2">
        {`${unit} ${left < 0 ? "over" : "left"}${value.complete ? "" : ", incomplete"}`}
      </span>
    </div>
  );
}

function ItemRow({
  person,
  item,
  online,
}: {
  person: number;
  item: PlannedItem;
  online: boolean;
}) {
  const client = useQueryClient();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: planKey(person) }),
      refreshToday(client, person),
      refreshDays(client, person),
    ]);
  const act = useMutation({
    networkMode: "always",
    mutationFn: async (action: ItemAction) => {
      if (!online || !navigator.onLine) throw new Error("Offline");
      await actOnItem(item, action);
    },
    onSuccess: refresh,
    // The item changed elsewhere; reload to show its current state.
    onError: async (error) => {
      if (error instanceof ApiError && [404, 409].includes(error.status)) {
        await refresh();
        act.reset();
      }
    },
  });
  const name =
    item.servings === null || item.servings === 1
      ? item.reference.name
      : `${item.reference.name} × ${displayNumber(item.servings)}`;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 [overflow-wrap:anywhere]">{name}</h3>
        {item.state === "eaten" && <Badge tone="ok">Eaten</Badge>}
        {item.state === "skipped" && <Badge>Skipped</Badge>}
      </div>
      {item.state === "planned" && (
        <>
          {item.nutrition.status !== "known" && (
            <p className="m-0 mt-1 text-step--1 text-caution">
              {item.nutrition.status === "pending"
                ? "Nutrition pending"
                : "Nutrition missing"}
            </p>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {actions.map(([action, label, variant]) => (
              <Button
                key={action}
                variant={variant}
                className={cn("w-full", press)}
                aria-label={`${label}: ${item.reference.name}`}
                disabled={
                  !online ||
                  act.isPending ||
                  (action !== "skip" && item.nutrition.status !== "known")
                }
                onClick={() => act.mutate(action)}
              >
                {label}
              </Button>
            ))}
          </div>
        </>
      )}
      {act.isError && <p role="alert">Couldn’t update meal</p>}
    </div>
  );
}
