import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { displayNumber, refreshToday } from "./today-api.ts";

const statusText = {
  no_day_type: "No plan for today",
  needs_profile: "Set up your profile to see budgets",
  needs_weigh_in: "Log a weight to see budgets",
};
const actions: [ItemAction, string][] = [
  ["ate", "Ate"],
  ["ate_three_quarters", "Ate 3/4"],
  ["skip", "Skip"],
];

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
  return (
    <section aria-label="Slots">
      <h2>Slots</h2>
      {failed && <p role="alert">Couldn’t load slots</p>}
      {!plan && !failed && (
        <p>{online ? "Loading..." : "Unavailable offline"}</p>
      )}
      {status && status !== "ready" && <p>{statusText[status]}</p>}
      {plan && <Suggestion person={person} plan={plan} online={online} />}
      {plan && plan.slots.length > 0 && (
        <ul className="entries">
          {plan.slots.map((slot) => {
            const budget = plan.budgets.slots.find(
              (row) => row.position === slot.position,
            );
            const items = plan.planned_items.filter(
              (item) => item.position === slot.position,
            );
            return (
              <li key={slot.position}>
                <strong>{slot.name}</strong>
                {budget && (
                  <span>
                    {remainingText(budget.kcal, "kcal")}
                    {", "}
                    {remainingText(budget.protein_g, "g protein")}
                    {budget.ended && " · Ended"}
                  </span>
                )}
                {items.length === 0 && <p>Nothing planned</p>}
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    person={person}
                    item={item}
                    online={online}
                  />
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
    <div className="suggestion">
      <p>
        Suggested shares:{" "}
        {plan.slots
          .map(
            (slot) =>
              `${slot.name} ${shares.find((value) => value.position === slot.position)?.share}%`,
          )
          .join(", ")}
      </p>
      <button
        type="button"
        disabled={!online || accept.isPending}
        onClick={() => accept.mutate()}
      >
        Accept
      </button>
      <button type="button" onClick={() => setIgnored(true)}>
        Ignore
      </button>
      {accept.isError && <p role="alert">Couldn’t save shares</p>}
    </div>
  );
}

function remainingText(
  value: Plan["budgets"]["slots"][number]["kcal"],
  unit: string,
) {
  if (value.budget === null) return `${unit} budget unknown`;
  // The engine leaves remaining null while any entry lacks this nutrient.
  const left = value.remaining ?? value.budget - value.known_subtotal;
  const text =
    left < 0
      ? `${displayNumber(-left)} ${unit} over`
      : `${displayNumber(left)} ${unit} left`;
  return value.complete ? text : `${text}, incomplete`;
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
    <div className="planned-item">
      <span>{name}</span>
      {item.state === "eaten" && <span>Eaten</span>}
      {item.state === "skipped" && <span>Skipped</span>}
      {item.state === "planned" && (
        <>
          {item.nutrition.status !== "known" && (
            <span>
              {item.nutrition.status === "pending"
                ? "Nutrition pending"
                : "Nutrition missing"}
            </span>
          )}
          {actions.map(([action, label]) => (
            <button
              key={action}
              type="button"
              aria-label={`${label}: ${item.reference.name}`}
              disabled={
                !online ||
                act.isPending ||
                (action !== "skip" && item.nutrition.status !== "known")
              }
              onClick={() => act.mutate(action)}
            >
              {label}
            </button>
          ))}
        </>
      )}
      {act.isError && <p role="alert">Couldn’t update meal</p>}
    </div>
  );
}
