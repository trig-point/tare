import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, liveRefresh } from "./api.ts";
import { type FoodMatch, foodMatchesQuery } from "./food-api.ts";
import { clientId } from "./outbox-store.ts";
import {
  type Decision,
  deleteBinding,
  failureText,
  linkKey,
  type Pantry,
  pantryKey,
  readLink,
  readPantry,
  readRequests,
  reconcile,
  refreshPantry,
  requestsKey,
  resetPantry,
  type StockRequest,
  type StockRequests,
  saveBinding,
} from "./pantry-api.ts";

type Props = { person: number; online: boolean };

const forbidden = (error: unknown) =>
  error instanceof ApiError && error.status === 403;

export function PantrySection({ person, online }: Props) {
  const options = { ...liveRefresh, retry: false };
  // Only the Grocy owner has a pantry; a 403 stops polling and hides the section.
  const pantry = useQuery({
    ...options,
    queryKey: pantryKey(person),
    queryFn: ({ signal }) => readPantry(signal),
    enabled: (query) => online && !forbidden(query.state.error),
  });
  const owner = { ...options, enabled: online && pantry.data !== undefined };
  const requests = useQuery({
    ...owner,
    queryKey: requestsKey(person),
    queryFn: ({ signal }) => readRequests(signal),
  });
  const link = useQuery({
    ...owner,
    queryKey: linkKey(person),
    queryFn: ({ signal }) => readLink(signal),
  });
  if (forbidden(pantry.error)) return null;
  return (
    <PantryView
      person={person}
      online={online}
      pantry={pantry.data}
      failed={pantry.isError}
      requests={requests.data}
      requestsFailed={requests.isError}
      link={link.data ?? null}
    />
  );
}

const time = (value: string) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

function status(pantry: Pantry) {
  if (pantry.state === "disabled") return "Pantry not set up";
  if (pantry.state === "reset_required")
    return "Pantry connection needs a reset";
  if (pantry.state === "never_refreshed") return "Pantry not refreshed yet";
  return pantry.stale ? "Stock may be out of date" : null;
}

export function PantryView({
  person,
  online,
  pantry,
  failed,
  requests,
  requestsFailed,
  link,
}: Props & {
  pantry: Pantry | undefined;
  failed: boolean;
  requests: StockRequests | undefined;
  requestsFailed: boolean;
  link: string | null;
}) {
  const client = useQueryClient();
  const reload = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: pantryKey(person) }),
      client.invalidateQueries({ queryKey: requestsKey(person) }),
    ]);
  const change = useMutation({
    mutationFn: (run: () => Promise<Pantry>) => run(),
    onSuccess: (next) => client.setQueryData(pantryKey(person), next),
    onSettled: reload,
  });
  const ready =
    pantry?.state === "ready" || pantry?.state === "never_refreshed";
  const notice = pantry && status(pantry);
  const units = new Map(
    pantry?.products.map((product) => [product.product_id, product]),
  );
  return (
    <section aria-label="Pantry">
      <h2>Pantry</h2>
      {link && (
        <p>
          <a href={link} target="_blank" rel="noreferrer">
            Add stock in Grocy
          </a>
        </p>
      )}
      {failed && <p role="alert">Couldn’t load pantry</p>}
      {!pantry && !failed && (
        <p>{online ? "Loading..." : "Unavailable offline"}</p>
      )}
      {notice && <p>{notice}</p>}
      {pantry?.error && <p role="alert">Refresh failed</p>}
      {pantry?.last_success_at && (
        <p>
          Updated{" "}
          <time dateTime={pantry.last_success_at}>
            {time(pantry.last_success_at)}
          </time>
        </p>
      )}
      {(ready || pantry?.state === "reset_required") && (
        <button
          type="button"
          disabled={!online || change.isPending}
          onClick={() => change.mutate(ready ? refreshPantry : resetPantry)}
        >
          {ready ? "Refresh" : "Reset connection"}
        </button>
      )}
      {change.isError && <p role="alert">{failureText(change.error)}</p>}
      {pantry?.state === "ready" &&
        pantry.products.length === 0 &&
        !pantry.error && <p>No stock</p>}
      {ready && pantry.products.length > 0 && (
        <ul className="entries">
          {pantry.products.map((product) => {
            const held = pantry.requested
              .filter(
                (entry) =>
                  entry.product_id === product.product_id &&
                  entry.stock_unit_id === product.stock_unit.id,
              )
              .reduce(
                (sum, entry) =>
                  sum + entry.pending + entry.sending + entry.uncertain,
                0,
              );
            return (
              <li key={product.product_id}>
                <strong>{product.name}</strong> {product.amount}{" "}
                {product.stock_unit.name}
                {held > 0 && <span> ({held} requested)</span>}
              </li>
            );
          })}
        </ul>
      )}
      {ready && (
        <>
          <h3>Bindings</h3>
          {pantry.bindings.length === 0 && <p>No bindings</p>}
          <ul className="entries">
            {pantry.bindings.map((binding) => (
              <li key={`${binding.reference_kind}-${binding.reference_id}`}>
                <strong>
                  {units.get(binding.product_id)?.name ??
                    `Product ${binding.product_id}`}
                </strong>{" "}
                {binding.quantity_per_serving} per serving of{" "}
                {binding.name ??
                  `${binding.reference_kind === "food" ? "food" : "source food"} ${binding.reference_id}`}
                {binding.status !== "valid" && (
                  <span> ({binding.status.replaceAll("_", " ")})</span>
                )}{" "}
                <button
                  type="button"
                  disabled={!online || change.isPending}
                  onClick={() =>
                    change.mutate(() =>
                      deleteBinding(
                        binding.reference_kind,
                        binding.reference_id,
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <BindingForm
            person={person}
            pantry={pantry}
            disabled={!online || change.isPending}
            save={(run) => change.mutate(run)}
          />
        </>
      )}
      <Requests
        requests={requests}
        failed={requestsFailed}
        online={online}
        products={units}
        reload={reload}
      />
    </section>
  );
}

function BindingForm({
  person,
  pantry,
  disabled,
  save,
}: {
  person: number;
  pantry: Pantry;
  disabled: boolean;
  save: (run: () => Promise<Pantry>) => void;
}) {
  const [name, setName] = useState("");
  const [food, setFood] = useState<FoodMatch | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const search = useQuery({
    ...foodMatchesQuery(person, name),
    enabled: !disabled && name.trim().length >= 2 && food === null,
  });
  const product = pantry.products.find(
    (entry) => String(entry.product_id) === productId,
  );
  const amount = Number(quantity);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!food || !product || pantry.generation === null || !(amount > 0))
      return;
    save(() =>
      saveBinding({
        reference_kind: food.reference.kind,
        reference_id: food.reference.id,
        product_id: product.product_id,
        stock_unit_id: product.stock_unit.id,
        quantity_per_serving: amount,
        expected_generation: pantry.generation as number,
      }),
    );
  }
  return (
    <form aria-label="Bind food" onSubmit={submit}>
      <fieldset disabled={disabled}>
        <label htmlFor="pantry-food">Food</label>
        <input
          id="pantry-food"
          type="search"
          autoComplete="off"
          value={food ? food.name : name}
          onChange={(event) => {
            setFood(null);
            setName(event.target.value);
          }}
        />
        {!food && search.isError && <p role="alert">Couldn’t search foods</p>}
        {!food && search.data && (
          <FoodResults foods={search.data} choose={setFood} />
        )}
        <label htmlFor="pantry-product">Product</label>
        <select
          id="pantry-product"
          required
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
        >
          <option value="">Choose a product</option>
          {pantry.products.map((entry) => (
            <option key={entry.product_id} value={entry.product_id}>
              {entry.name}
            </option>
          ))}
        </select>
        <label htmlFor="pantry-quantity">
          Per serving{product ? ` (${product.stock_unit.name})` : ""}
        </label>
        <input
          id="pantry-quantity"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          required
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <button type="submit" disabled={!food || !(amount > 0)}>
          Bind
        </button>
      </fieldset>
    </form>
  );
}

export function FoodResults({
  foods,
  choose,
}: {
  foods: FoodMatch[];
  choose: (food: FoodMatch) => void;
}) {
  if (foods.length === 0) return <p>No foods found</p>;
  return (
    <ul className="entries" aria-label="Foods">
      {foods.map((food) => (
        <li key={`${food.reference.kind}-${food.reference.id}`}>
          <strong>{food.name}</strong>
          {food.brand && <span>{food.brand}</span>}
          {food.serving && <span>{food.serving}</span>}
          <button
            type="button"
            aria-label={`Choose ${food.name}`}
            onClick={() => choose(food)}
          >
            Choose
          </button>
        </li>
      ))}
    </ul>
  );
}

// A frozen request keeps its own unit; the product's unit may have changed since.
function unitName(
  products: Map<number, Pantry["products"][number]>,
  frozen: StockRequest["frozen"],
) {
  const unit = products.get(frozen.product_id)?.stock_unit;
  return unit?.id === frozen.stock_unit_id
    ? unit.name
    : `unit ${frozen.stock_unit_id}`;
}

function Requests({
  requests,
  failed,
  online,
  products,
  reload,
}: {
  requests: StockRequests | undefined;
  failed: boolean;
  online: boolean;
  products: Map<number, Pantry["products"][number]>;
  reload: () => Promise<unknown>;
}) {
  if (failed) return <p role="alert">Couldn’t load stock requests</p>;
  if (!requests || requests.state === "disabled") return null;
  const label = (request: StockRequest) =>
    [
      `${request.intake?.name ?? `Food ${request.reference.id}`}:`,
      request.frozen.quantity,
      unitName(products, request.frozen),
      request.state,
      request.edit_notice &&
        `(edited to ${request.edit_notice.servings} servings)`,
      `· ${time(request.created_at)}`,
    ]
      .filter((part) => part !== undefined && part !== null)
      .join(" ");
  return (
    <>
      <h3>Stock requests</h3>
      {requests.unresolved.length === 0 && <p>No open requests</p>}
      <ul className="entries">
        {requests.unresolved.map((request) => (
          <li key={request.request_id}>
            <strong>{label(request)}</strong>
            <Decisions request={request} online={online} reload={reload} />
          </li>
        ))}
      </ul>
      {requests.history.length > 0 && (
        <details>
          <summary>Recent requests</summary>
          <ul className="entries">
            {requests.history.map((request) => (
              <li key={request.request_id}>{label(request)}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Decisions({
  request,
  online,
  reload,
}: {
  request: StockRequest;
  online: boolean;
  reload: () => Promise<unknown>;
}) {
  // One id per chosen decision, so resending after a lost response replays it.
  const [ids] = useState(() => new Map<string, string>());
  const decide = useMutation({
    mutationFn: (decision: Decision) => {
      const key = `${request.current_number}:${decision}`;
      const id = ids.get(key) ?? clientId(crypto);
      ids.set(key, id);
      return reconcile({
        request_id: request.request_id,
        attempt_number: request.current_number,
        mutation_id: id,
        decision,
      });
    },
    onSettled: reload,
  });
  const choices: [Decision, string][] =
    request.state === "pending"
      ? [["abandoned", "Abandon"]]
      : request.state === "uncertain" || request.state === "rejected"
        ? [
            ["delivered", "Delivered"],
            ...(request.retry.eligible
              ? [["not_delivered_retry", "Retry"] as [Decision, string]]
              : []),
            ["abandoned", "Abandon"],
          ]
        : [];
  return (
    <>
      {choices.length > 0 && (
        <p className="actions">
          {choices.map(([decision, text]) => (
            <button
              key={decision}
              type="button"
              disabled={!online || decide.isPending}
              onClick={() => decide.mutate(decision)}
            >
              {text}
            </button>
          ))}
        </p>
      )}
      {!request.retry.eligible && request.retry.not_before && (
        <p>Retry after {time(request.retry.not_before)}</p>
      )}
      {decide.isError && <p role="alert">{failureText(decide.error)}</p>}
    </>
  );
}
