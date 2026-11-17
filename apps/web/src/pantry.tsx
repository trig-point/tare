import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { ApiError, liveRefresh } from "./api.ts";
import { type FoodMatch, foodMatchesQuery } from "./food-api.ts";
import { clientId } from "./outbox-store.ts";
import {
  type Decision,
  deleteBinding,
  failureText,
  linkKey,
  type Pantry,
  type PantryProducts,
  pantryKey,
  productsKey,
  readLink,
  readPantry,
  readProducts,
  readRequests,
  reconcile,
  refreshPantry,
  requestsKey,
  resetPantry,
  type StockRequest,
  type StockRequests,
  saveBinding,
} from "./pantry-api.ts";
import {
  Button,
  cn,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./shared/ui/index.ts";
import { sourceName } from "./today-api.ts";

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
  const catalog = useQuery({
    ...owner,
    queryKey: productsKey(person),
    queryFn: ({ signal }) => readProducts(signal),
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
      catalog={
        catalog.isError
          ? { state: "unavailable", generation: null, products: [] }
          : catalog.data
      }
    />
  );
}

const time = (value: string) =>
  new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

const press =
  "transition-transform duration-(--motion-press) ease-move active:scale-[0.97]";
const panel =
  "pt-4 data-[state=inactive]:hidden data-[state=active]:animate-[screen-enter_var(--motion-tab)_var(--motion-ease-enter)]";
const hint = "text-sm text-ink-2";
const row =
  "flex items-start justify-between gap-3 border-b border-border py-3 last:border-b-0";
const notice = "m-0 rounded-(--radius) bg-bg-sunk px-3 py-2.5 text-sm";
const ghost = cn(press, "hover:bg-bg-sunk hover:text-ink");
const quiet = cn(
  press,
  "text-destructive hover:bg-bg-sunk hover:text-destructive",
);

type Product = Pantry["products"][number];
const unitText = (amount: number, unit: Product["stock_unit"]) =>
  (amount > 0 && amount <= 1) || !unit.name_plural
    ? unit.name
    : unit.name_plural;
const words = (value: string) => {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function Badge({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "caution" | "ok";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-(--radius) bg-bg-sunk px-1.5 py-0.5 text-xs font-medium",
        tone === "caution" && "text-caution",
        tone === "ok" && "text-ok",
        tone === "plain" && "text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

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
  catalog,
}: Props & {
  pantry: Pantry | undefined;
  failed: boolean;
  requests: StockRequests | undefined;
  requestsFailed: boolean;
  link: string | null;
  catalog?: PantryProducts;
}) {
  const client = useQueryClient();
  const [tab, setTab] = useState("stock");
  // Products are read live from Grocy, so mutations do not wait for them.
  const reload = () => {
    void client.invalidateQueries({ queryKey: productsKey(person) });
    return Promise.all([
      client.invalidateQueries({ queryKey: pantryKey(person) }),
      client.invalidateQueries({ queryKey: requestsKey(person) }),
    ]);
  };
  const change = useMutation({
    mutationFn: (run: () => Promise<Pantry>) => run(),
    onSuccess: (next) => client.setQueryData(pantryKey(person), next),
    onSettled: reload,
  });
  const ready =
    pantry?.state === "ready" || pantry?.state === "never_refreshed";
  const message = pantry && status(pantry);
  const units = new Map(
    pantry?.products.map((product) => [product.product_id, product]),
  );
  const bindingsTab = useRef<HTMLButtonElement>(null);
  // A pantry awaiting reset still lists its open requests, and they block the reset.
  const open =
    requests && requests.state !== "disabled" && !requestsFailed
      ? requests.unresolved.length
      : null;
  const shown = tab === "bindings" && !ready ? "stock" : tab;
  return (
    <section
      aria-label="Pantry"
      className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-6 pb-6"
    >
      <div className="page-head">
        <div>
          <h1 className="m-0 text-(length:--step-3) font-semibold tracking-tight">
            Pantry
          </h1>
          <p className={cn(hint, "m-0 mt-1")}>Stock from Grocy</p>
        </div>
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className={cn(hint, "m-0 text-xs")}>
          {pantry?.last_success_at && (
            <>
              Updated{" "}
              <time dateTime={pantry.last_success_at}>
                {time(pantry.last_success_at)}
              </time>
            </>
          )}
        </p>
        {(ready || pantry?.state === "reset_required") && (
          <Button
            type="button"
            variant="ghost"
            className={ready ? ghost : quiet}
            disabled={!online || change.isPending}
            onClick={() => change.mutate(ready ? refreshPantry : resetPantry)}
          >
            {ready && (
              <RefreshCw
                aria-hidden
                className={cn(change.isPending && "motion-safe:animate-spin")}
              />
            )}
            {ready ? "Refresh" : "Reset connection"}
          </Button>
        )}
      </div>
      {failed && (
        <p role="alert" className={cn(notice, "text-destructive")}>
          Couldn’t load pantry
        </p>
      )}
      {!pantry && !failed && !online && (
        <p className={notice}>Unavailable offline</p>
      )}
      {!pantry && !failed && online && (
        <div>
          <p className="sr-only">Loading...</p>
          <div
            aria-hidden
            className="h-[360px] rounded-(--radius) bg-bg-sunk motion-safe:animate-pulse"
          />
        </div>
      )}
      {message && <p className={notice}>{message}</p>}
      {pantry?.error && (
        <p role="alert" className={cn(notice, "text-destructive")}>
          Refresh failed
        </p>
      )}
      {change.isError && (
        <p role="alert" className={cn(notice, "text-destructive")}>
          {failureText(change.error)}
        </p>
      )}
      {pantry && pantry.state !== "disabled" && (
        <Tabs value={shown} onValueChange={setTab} className="gap-0">
          <TabsList
            variant="line"
            className="w-full border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto"
          >
            <TabsTrigger value="stock" className={trigger}>
              Stock
            </TabsTrigger>
            {ready && (
              <TabsTrigger
                ref={bindingsTab}
                value="bindings"
                className={trigger}
              >
                Bindings <Badge>{pantry.bindings.length}</Badge>
              </TabsTrigger>
            )}
            <TabsTrigger value="requests" className={trigger}>
              Requests{" "}
              {open !== null && (
                <Badge tone={open > 0 ? "caution" : "plain"}>{open}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="stock" forceMount className={panel}>
            <Stock
              pantry={pantry}
              ready={ready}
              link={link}
              view={() => {
                setTab("bindings");
                bindingsTab.current?.focus();
              }}
            />
          </TabsContent>
          {ready && (
            <TabsContent value="bindings" forceMount className={panel}>
              <Bindings
                pantry={pantry}
                products={units}
                disabled={!online || change.isPending}
                remove={(binding) =>
                  change.mutate(() =>
                    deleteBinding(binding.reference_kind, binding.reference_id),
                  )
                }
              />
              <BindingForm
                person={person}
                pantry={pantry}
                catalog={catalog}
                disabled={!online || change.isPending}
                save={(run) => change.mutate(run)}
              />
            </TabsContent>
          )}
          <TabsContent value="requests" forceMount className={panel}>
            <Requests
              requests={requests}
              failed={requestsFailed}
              online={online}
              products={units}
              reload={reload}
            />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

const trigger =
  "min-h-11 py-2.5 duration-(--motion-tab) group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] after:duration-(--motion-tab)";

function Stock({
  pantry,
  ready,
  link,
  view,
}: {
  pantry: Pantry;
  ready: boolean;
  link: string | null;
  view: () => void;
}) {
  const attention = ready
    ? pantry.bindings.filter((binding) => binding.status !== "valid")
    : [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {pantry.state === "ready" &&
        pantry.products.length === 0 &&
        !pantry.error && <p className={cn(hint, "m-0")}>No stock</p>}
      {ready && pantry.products.length > 0 && (
        <div>
          <div className="flex justify-between border-b border-border pb-2 text-xs text-ink-2">
            <span>In stock</span>
            <span>Amount</span>
          </div>
          <ul aria-label="Stock" className="m-0 list-none p-0">
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
                <li key={product.product_id} className={cn(row, "py-3.5")}>
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <strong className="block font-medium">
                      {product.name}
                    </strong>
                    {held > 0 && (
                      <small className="numeric mt-1 block text-xs text-caution">
                        {held} {unitText(held, product.stock_unit)} requested
                      </small>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "numeric",
                        product.amount <= 0 && "text-ink-2",
                      )}
                    >
                      {product.amount}{" "}
                      {unitText(product.amount, product.stock_unit)}
                    </span>
                    {product.amount <= 0 && (
                      <small className="mt-1 block text-xs text-caution">
                        Out of stock
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {link && (
        <Button
          asChild
          variant="secondary"
          size="lg"
          className={cn(press, "w-full")}
        >
          <a href={link} target="_blank" rel="noreferrer">
            Add stock in Grocy
          </a>
        </Button>
      )}
      {attention.length > 0 && (
        <div className="flex items-center gap-3 rounded-(--radius) bg-bg-sunk px-3 py-2.5">
          <div className="min-w-0 grow [overflow-wrap:anywhere]">
            <strong className="block font-medium">
              {attention.length === 1
                ? "1 binding needs attention"
                : `${attention.length} bindings need attention`}
            </strong>
            <p className={cn(hint, "m-0 mt-1 text-xs")}>
              {attention
                .map(
                  (binding) =>
                    `${bindingFood(binding)} / ${words(binding.status)}`,
                )
                .join(", ")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className={ghost}
            onClick={view}
          >
            View
          </Button>
        </div>
      )}
    </div>
  );
}

type Binding = Pantry["bindings"][number];
const bindingFood = (binding: Binding) =>
  binding.name ??
  `${binding.reference_kind === "food" ? "food" : "source food"} ${binding.reference_id}`;

function Bindings({
  pantry,
  products,
  disabled,
  remove,
}: {
  pantry: Pantry;
  products: Map<number, Product>;
  disabled: boolean;
  remove: (binding: Binding) => void;
}) {
  return (
    <div>
      <h2 className="m-0 text-(length:--step-2) font-semibold">
        Food bindings
      </h2>
      {pantry.bindings.length === 0 && (
        <p className={cn(hint, "m-0 mt-2")}>No bindings</p>
      )}
      <ul aria-label="Bindings" className="m-0 list-none p-0">
        {pantry.bindings.map((binding) => {
          const product = products.get(binding.product_id);
          return (
            <li
              key={`${binding.reference_kind}-${binding.reference_id}`}
              className={row}
            >
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <strong className="block font-medium">
                  {product?.name ?? `Product ${binding.product_id}`}
                </strong>
                <p className={cn(hint, "m-0 mt-1")}>
                  <span className="numeric">
                    {binding.quantity_per_serving}
                    {product &&
                      binding.status === "valid" &&
                      ` ${unitText(binding.quantity_per_serving, product.stock_unit)}`}
                  </span>{" "}
                  per serving of {bindingFood(binding)}
                </p>
                {binding.status !== "valid" && (
                  <p className="m-0 mt-1.5">
                    <Badge tone="caution">{words(binding.status)}</Badge>
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                className={quiet}
                disabled={disabled}
                onClick={() => remove(binding)}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BindingForm({
  person,
  pantry,
  catalog,
  disabled,
  save,
}: {
  person: number;
  pantry: Pantry;
  catalog: PantryProducts | undefined;
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
  // A list from before a connection reset may name another database's products.
  const choices =
    catalog?.state === "ready" && catalog.generation === pantry.generation
      ? catalog.products
      : pantry.products;
  const product = choices.find(
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
  const field = "grid min-w-0 gap-1.5 text-sm font-medium";
  return (
    <form
      aria-label="Bind food"
      onSubmit={submit}
      className="mt-5 rounded-(--radius) border border-border bg-surface p-4"
    >
      <fieldset
        disabled={disabled}
        className="m-0 grid min-w-0 gap-3 border-0 p-0"
      >
        <legend className="mb-3 p-0 text-(length:--step-1) font-semibold">
          Bind a food
        </legend>
        <div className={field}>
          <label htmlFor="pantry-food">Food</label>
          <Input
            id="pantry-food"
            type="search"
            autoComplete="off"
            placeholder="Search by name"
            value={food ? food.name : name}
            onChange={(event) => {
              setFood(null);
              setName(event.target.value);
            }}
          />
        </div>
        {!food && search.isError && (
          <p role="alert" className="m-0 text-sm text-destructive">
            Couldn’t search foods
          </p>
        )}
        {!food && search.data && (
          <FoodResults foods={search.data} choose={setFood} />
        )}
        <div className={field}>
          <label htmlFor="pantry-product">Product</label>
          <select
            id="pantry-product"
            required
            className="m-0 min-w-0 max-w-full"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Choose a product</option>
            {choices.map((entry) => (
              <option key={entry.product_id} value={entry.product_id}>
                {entry.name} ({entry.amount} {entry.stock_unit.name})
              </option>
            ))}
          </select>
        </div>
        {catalog?.state === "unavailable" && (
          <p role="alert" className="m-0 text-sm text-destructive">
            Grocy unavailable
          </p>
        )}
        <div className={field}>
          <label htmlFor="pantry-quantity">
            Per serving{product ? ` (${product.stock_unit.name})` : ""}
          </label>
          <Input
            id="pantry-quantity"
            type="number"
            inputMode="decimal"
            className="numeric"
            min="0"
            step="any"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className={cn(press, "mt-1 w-full")}
          disabled={!food || !product || !(amount > 0)}
        >
          Bind
        </Button>
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
  if (foods.length === 0)
    return <p className={cn(hint, "m-0")}>No foods found</p>;
  return (
    <ul aria-label="Foods" className="m-0 list-none p-0">
      {foods.map((food) => (
        <li
          key={`${food.reference.kind}-${food.reference.id}`}
          className={cn(row, "items-center")}
        >
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <strong className="block font-medium">{food.name}</strong>
            <p className={cn(hint, "m-0 mt-1")}>
              {[
                food.brand,
                food.serving,
                food.source && sourceName(food.source),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className={press}
            aria-label={`Choose ${food.name}`}
            onClick={() => choose(food)}
          >
            Choose
          </Button>
        </li>
      ))}
    </ul>
  );
}

// A frozen request keeps its own unit; the product's unit may have changed since.
function unitName(
  products: Map<number, Product>,
  frozen: StockRequest["frozen"],
) {
  const unit = products.get(frozen.product_id)?.stock_unit;
  return unit?.id === frozen.stock_unit_id
    ? unitText(frozen.quantity, unit)
    : `unit ${frozen.stock_unit_id}`;
}

const stateTone = (state: StockRequest["state"]) =>
  state === "delivered"
    ? "ok"
    : state === "cancelled" || state === "abandoned"
      ? "plain"
      : "caution";

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
  products: Map<number, Product>;
  reload: () => Promise<unknown>;
}) {
  if (failed)
    return (
      <p role="alert" className={cn(notice, "text-destructive")}>
        Couldn’t load stock requests
      </p>
    );
  if (!requests)
    return (
      <p className={cn(hint, "m-0")}>
        {online ? "Loading..." : "Unavailable offline"}
      </p>
    );
  if (requests.state === "disabled") return null;
  const name = (request: StockRequest) =>
    request.intake?.name ?? `Food ${request.reference.id}`;
  const amount = (request: StockRequest) =>
    `${request.frozen.quantity} ${unitName(products, request.frozen)}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="m-0 text-(length:--step-2) font-semibold">
        Stock requests
      </h2>
      {requests.unresolved.length === 0 && (
        <p className={cn(hint, "m-0")}>No open requests</p>
      )}
      <ul aria-label="Open requests" className="m-0 grid list-none gap-3 p-0">
        {requests.unresolved.map((request) => (
          <li
            key={request.request_id}
            className="min-w-0 rounded-(--radius) border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <strong className="min-w-0 font-medium [overflow-wrap:anywhere]">
                {name(request)}
              </strong>
              <Badge tone={stateTone(request.state)}>
                {words(request.state)}
              </Badge>
            </div>
            <p className="numeric m-0 mt-2 [overflow-wrap:anywhere]">
              {amount(request)}
            </p>
            {request.edit_notice && (
              <p className={cn(hint, "m-0 mt-1")}>
                Edited to {request.edit_notice.servings} servings
              </p>
            )}
            <p className={cn(hint, "m-0 mt-1 text-xs")}>
              <time dateTime={request.created_at}>
                {time(request.created_at)}
              </time>
            </p>
            <Decisions request={request} online={online} reload={reload} />
          </li>
        ))}
      </ul>
      {requests.history.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
            Recent requests
            <ChevronDown
              aria-hidden
              className="size-4 text-ink-3 transition-transform duration-(--motion-tab) group-open:rotate-180"
            />
          </summary>
          <ul aria-label="Recent requests" className="m-0 list-none p-0">
            {requests.history.map((request) => (
              <li key={request.request_id} className={row}>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <strong className="block font-medium">{name(request)}</strong>
                  <p className={cn(hint, "m-0 mt-1")}>
                    <span className="numeric">{amount(request)}</span> /{" "}
                    <span
                      className={cn(request.state === "delivered" && "text-ok")}
                    >
                      {words(request.state)}
                    </span>
                  </p>
                  {request.edit_notice && (
                    <p className={cn(hint, "m-0 mt-1")}>
                      Edited to {request.edit_notice.servings} servings
                    </p>
                  )}
                  <p className={cn(hint, "m-0 mt-1 text-xs")}>
                    {time(request.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
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
        <div className="mt-3 flex flex-wrap gap-2">
          {choices.map(([decision, text]) => (
            <Button
              key={decision}
              type="button"
              variant={decision === "abandoned" ? "ghost" : "secondary"}
              className={decision === "abandoned" ? quiet : press}
              disabled={!online || decide.isPending}
              onClick={() => decide.mutate(decision)}
            >
              {text}
            </Button>
          ))}
        </div>
      )}
      {!request.retry.eligible && request.retry.not_before && (
        <p className={cn(hint, "m-0 mt-2")}>
          Retry after {time(request.retry.not_before)}
        </p>
      )}
      {decide.isError && (
        <p role="alert" className="m-0 mt-2 text-sm text-destructive">
          {failureText(decide.error)}
        </p>
      )}
    </>
  );
}
