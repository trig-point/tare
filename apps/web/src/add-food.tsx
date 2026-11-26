import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import type { Session } from "./api.ts";
import { BarcodeScanner } from "./barcode-scan.tsx";
import { EatingOutSwitch, useFoodChoiceTag } from "./eating-out.tsx";
import {
  type CatalogResult,
  catalogQuery,
  choiceTags,
  enqueueFood,
  enqueueNumbers,
  type FoodChoice,
  lookupBarcode,
  matchingFoods,
  mergeChoices,
  savedUsualFoods,
  searchOnline,
  usualFoodsQuery,
} from "./food-api.ts";
import type { OutboxReplay } from "./outbox-replay.ts";
import { photoProbeQuery, savedPhotoProbe } from "./photo-api.ts";
import { PhotoMeal } from "./photo-meal.tsx";
import {
  Button,
  cn,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./shared/ui/index.ts";
import {
  displayNumber,
  type Intake,
  nutrients,
  todayQuery,
} from "./today-api.ts";

type Props = {
  person: Session["user"];
  replay: OutboxReplay;
  online: boolean;
};
type Nutrient = (typeof nutrients)[number];

const press =
  "transition-transform duration-(--motion-press) ease-move active:scale-[0.97]";
const panel =
  "pt-4 data-[state=active]:animate-[screen-enter_var(--motion-tab)_var(--motion-ease-enter)]";
const hint = "text-sm text-ink-2";

export function AddFood({ person, replay, online }: Props) {
  const [tab, setTab] = useState("search");
  const [name, setName] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const [logged, setLogged] = useState("");
  const term = name.trim();
  const today = useQuery({ ...todayQuery(person.id), enabled: online });
  const usual = useQuery({ ...usualFoodsQuery(person.id), enabled: online });
  const saved = useMemo(
    () => (online && !usual.isError ? null : savedUsualFoods(person.id)),
    [online, usual.isError, person.id],
  );
  const usualList = usual.data ?? saved;
  const catalog = useQuery({
    ...catalogQuery(person.id, name),
    enabled: online && term !== "",
  });
  const lookup = useMutation({
    mutationFn: async (name: string) => {
      const foods = await searchOnline(name);
      return { foods, updatedAt: Date.now() };
    },
    retry: 0,
  });
  const barcode = useMutation({ mutationFn: lookupBarcode, retry: 0 });
  const probe = useQuery({ ...photoProbeQuery(person.id), enabled: online });
  const photo = (probe.data ?? savedPhotoProbe(person.id)) !== false;
  const shown = !photo && tab === "photo" ? "search" : tab;
  const searched = lookup.variables === term ? lookup : undefined;
  const catalogMatches =
    catalog.data?.result === "match" ? catalog.data.foods : [];
  const recent = todayFoods(today.data?.entries ?? []);
  const live = [
    {
      foods: searched?.data?.foods ?? [],
      updatedAt: searched?.data?.updatedAt ?? 0,
    },
    { foods: catalogMatches, updatedAt: catalog.dataUpdatedAt },
    { foods: recent, updatedAt: today.dataUpdatedAt },
    { foods: usual.data ?? [], updatedAt: usual.dataUpdatedAt },
  ]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .flatMap(({ foods }) => foods);
  const refreshTags = (food: FoodChoice) => {
    const current = live.find(
      (choice) =>
        choice.reference.kind === food.reference.kind &&
        choice.reference.id === food.reference.id &&
        choice.can_tag_eating_out !== undefined,
    );
    return current ? { ...food, ...choiceTags(current) } : food;
  };
  const choices = mergeChoices(
    matchingFoods(usualList ?? [], term),
    catalogMatches,
    searched?.data?.foods ?? [],
  ).map(refreshTags);
  const catalogMissed =
    term !== "" &&
    catalog.data !== undefined &&
    catalog.data.result !== "match";
  const onLogged = (food: string) => {
    setLogged(`Logged ${food}`);
    setName("");
    lookup.reset();
    barcode.reset();
  };
  const rows = (foods: FoodChoice[], label: string) => (
    <FoodRows
      label={label}
      foods={foods}
      person={person}
      replay={replay}
      onLogged={onLogged}
    />
  );
  return (
    <section aria-label="Add food" className="grid gap-4 pt-6 pb-6">
      <div className="page-head">
        <h1 className="text-(length:--step-3) font-semibold tracking-tight">
          Add food
        </h1>
      </div>
      <Tabs
        value={shown}
        onValueChange={(next) => {
          setTab(next);
          setManual(null);
          setLogged("");
        }}
        className="gap-0"
      >
        <TabsList
          variant="line"
          className="w-full border-b border-border p-0 group-data-[orientation=horizontal]/tabs:h-auto"
        >
          {["Search", "Scan", ...(photo ? ["Photo"] : []), "Quick add"].map(
            (title) => (
              <TabsTrigger
                key={title}
                value={title.toLowerCase().replace(" ", "-")}
                className="min-h-11 py-2.5 duration-(--motion-tab) group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] after:duration-(--motion-tab)"
              >
                {title}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        <TabsContent
          value="search"
          className={cn(panel, "gap-3 data-[state=active]:grid")}
        >
          <label htmlFor="food-search" className="text-sm font-medium">
            Saved food
          </label>
          <Input
            id="food-search"
            type="search"
            autoComplete="off"
            placeholder="Search by name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setLogged("");
            }}
          />
          {term === "" ? (
            <UsualFoods
              state={
                online && usual.isError
                  ? "failed"
                  : usualList
                    ? "ready"
                    : !online
                      ? "offline"
                      : "loading"
              }
              foods={mergeChoices(usualList ?? [], recent).map(refreshTags)}
              rows={rows}
            />
          ) : (
            <>
              {!online && (
                <p className={hint}>Catalog search unavailable offline</p>
              )}
              {catalog.isError && <p role="alert">Couldn’t search foods</p>}
              {catalog.isPending && online && <RowSkeleton />}
              {catalog.data && (
                <CatalogMiss
                  result={catalog.data.result}
                  enterManually={() => setManual(term)}
                />
              )}
              {choices.length > 0 && rows(choices, "Matches")}
              {online && (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    press,
                    "-mx-2 justify-self-start px-2 text-accent",
                  )}
                  disabled={searched?.isPending ?? false}
                  onClick={() => lookup.mutate(term)}
                >
                  {searched?.isPending ? "Searching..." : "Search online"}
                </Button>
              )}
              {searched?.isError && <p role="alert">Couldn’t search online</p>}
              {searched?.data?.foods.length === 0 && (
                <OnlineMiss
                  enterManually={
                    catalogMissed ? undefined : () => setManual(term)
                  }
                />
              )}
            </>
          )}
        </TabsContent>
        <TabsContent
          value="scan"
          className={cn(panel, "gap-3 data-[state=active]:grid")}
        >
          <BarcodeScanner online={online} onCode={barcode.mutate} />
          {barcode.isPending && <RowSkeleton />}
          {barcode.isError && <p role="alert">Couldn’t look up barcode</p>}
          {barcode.data?.length === 0 && (
            <OnlineMiss enterManually={() => setManual("")} />
          )}
          {barcode.data &&
            barcode.data.length > 0 &&
            rows(barcode.data, "Barcode match")}
        </TabsContent>
        <TabsContent
          value="quick-add"
          forceMount
          className={cn(panel, "data-[state=inactive]:hidden")}
        >
          <QuickAdd
            person={person}
            replay={replay}
            done={() => setLogged("Logged Quick add")}
          />
        </TabsContent>
        {photo && (
          <TabsContent
            value="photo"
            forceMount
            className={cn(panel, "data-[state=inactive]:hidden")}
          >
            <PhotoMeal
              person={person}
              online={online}
              active={shown === "photo"}
              onLogged={setLogged}
            />
          </TabsContent>
        )}
      </Tabs>
      {manual !== null && (
        <NumbersForm
          key={manual}
          title="Enter manually"
          initialName={manual}
          person={person}
          replay={replay}
          done={(saved) => {
            setManual(null);
            onLogged(saved);
          }}
        />
      )}
      <output aria-live="polite" className={cn(hint, "min-h-5")}>
        {logged}
      </output>
      {!online && shown !== "photo" && (
        <p className={hint}>Logs send when you reconnect.</p>
      )}
    </section>
  );
}

/** Food-backed entries already loaded for today, newest first, one row per food. */
export function todayFoods(entries: Intake[]): FoodChoice[] {
  const foods = [...entries]
    .sort((left, right) => right.eaten_at.localeCompare(left.eaten_at))
    .flatMap((entry): FoodChoice[] => {
      const id = entry.food_id ?? entry.source_food_id;
      if (id === null || entry.name === null) return [];
      const perServing = (value: number | null) =>
        value === null || !entry.servings ? null : value / entry.servings;
      return [
        {
          reference: {
            kind: entry.food_id !== null ? "food" : "source_food",
            id,
          },
          name: entry.name,
          brand: null,
          serving: null,
          kcal: perServing(entry.kcal),
          protein_g: perServing(entry.protein_g),
          ...choiceTags(entry.food_choice ?? {}),
        },
      ];
    });
  return mergeChoices(foods);
}

function UsualFoods({
  state,
  foods,
  rows,
}: {
  state: "loading" | "failed" | "offline" | "ready";
  foods: FoodChoice[];
  rows: (foods: FoodChoice[], label: string) => ReactNode;
}) {
  return (
    <div className="grid gap-1 pt-2">
      <h2 className="m-0 text-(length:--step-1) font-semibold">Usual foods</h2>
      {state === "failed" && <p role="alert">Couldn’t load usual foods</p>}
      {foods.length > 0 ? (
        rows(foods, "Usual foods")
      ) : state === "loading" ? (
        <RowSkeleton />
      ) : state === "offline" ? (
        <p className={hint}>Unavailable offline</p>
      ) : (
        state === "ready" && (
          <p className={hint}>Foods you log often show here</p>
        )
      )}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-[116px] motion-safe:animate-pulse rounded-(--radius) bg-bg-sunk"
    />
  );
}

function FoodRows({
  label,
  foods,
  ...row
}: {
  label: string;
  foods: FoodChoice[];
  person: Session["user"];
  replay: OutboxReplay;
  onLogged: (name: string) => void;
}) {
  return (
    <ul aria-label={label} className="m-0 grid list-none p-0">
      {foods.map((food) => (
        <FoodRow
          key={`${food.reference.kind}-${food.reference.id}-${food.servings ?? 1}`}
          food={food}
          {...row}
        />
      ))}
    </ul>
  );
}

function FoodRow({
  food,
  person,
  replay,
  onLogged,
}: {
  food: FoodChoice;
  person: Session["user"];
  replay: OutboxReplay;
  onLogged: (name: string) => void;
}) {
  const usualServings = String(food.servings ?? 1);
  const [servings, setServings] = useState(usualServings);
  const tag = useFoodChoiceTag(food);
  const log = useMutation({
    networkMode: "always",
    mutationFn: () => enqueueFood(replay, person, food, servings, tag.override),
    onSuccess: () => {
      setServings(usualServings);
      tag.setSelected(undefined);
      onLogged(food.name);
    },
  });
  const id = `servings-${food.reference.kind}-${food.reference.id}`;
  const details = [
    food.brand,
    food.serving,
    food.kcal === null ? (
      "Unknown kcal"
    ) : (
      <span
        key="kcal"
        className="numeric"
      >{`${displayNumber(food.kcal)} kcal`}</span>
    ),
    food.protein_g === null ? (
      "Unknown protein"
    ) : (
      <Fragment key="protein">
        <span className="numeric">{`${displayNumber(food.protein_g)} g`}</span>{" "}
        protein
      </Fragment>
    ),
  ].filter((part) => part !== null);
  return (
    <li className="grid gap-2 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <strong className="block font-medium">{food.name}</strong>
        <p className={cn(hint, "m-0 mt-1")}>
          {details.map((part, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are fixed in order
            <Fragment key={index}>
              {index > 0 && " / "}
              {part}
            </Fragment>
          ))}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className={hint}>
          Servings
        </label>
        <Input
          id={id}
          type="number"
          min="0.01"
          step="any"
          inputMode="decimal"
          required
          className="numeric w-20 text-center"
          value={servings}
          onChange={(event) => setServings(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          aria-label={`Log ${food.name}`}
          className={cn(press, "ml-auto min-w-20")}
          disabled={log.isPending}
          onClick={() => log.mutate()}
        >
          Log
        </Button>
      </div>
      <EatingOutSwitch
        checked={tag.checked}
        eligible={food.can_tag_eating_out === true}
        disabled={log.isPending}
        onChange={tag.setSelected}
      />
      {log.isError && <p role="alert">Couldn’t log food</p>}
    </li>
  );
}

export function CatalogMiss({
  result,
  enterManually,
}: {
  result: CatalogResult["result"];
  enterManually: () => void;
}) {
  if (result === "match") return null;
  return <Miss text="No match" enterManually={enterManually} />;
}

export function OnlineMiss({ enterManually }: { enterManually?: () => void }) {
  return <Miss text="No exact match" enterManually={enterManually} />;
}

function Miss({
  text,
  enterManually,
}: {
  text: string;
  enterManually?: () => void;
}) {
  return (
    <p className={cn(hint, "m-0 flex items-center gap-2")}>
      {text}{" "}
      {enterManually && (
        <Button
          type="button"
          variant="link"
          className={cn(press, "px-1")}
          onClick={enterManually}
        >
          Enter manually
        </Button>
      )}
    </p>
  );
}

const fieldNames: Record<Nutrient, [string, string]> = {
  kcal: ["Calories", "kcal"],
  protein_g: ["Protein", "g"],
  carbs_g: ["Carbs", "g"],
  fat_g: ["Fat", "g"],
  fiber_g: ["Fiber", "g"],
};

export function QuickAdd(props: {
  person: Session["user"];
  replay: OutboxReplay;
  done: () => void;
}) {
  return <NumbersForm title="Quick add" required={["kcal"]} {...props} />;
}

function NumbersForm({
  title,
  initialName,
  required = [],
  person,
  replay,
  done,
}: {
  title: string;
  initialName?: string;
  required?: Nutrient[];
  person: Session["user"];
  replay: OutboxReplay;
  done: (saved: string) => void;
}) {
  const empty = () => Object.fromEntries(nutrients.map((key) => [key, ""]));
  const [name, setName] = useState(initialName ?? "");
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [eatingOut, setEatingOut] = useState(false);
  const [postedMenu, setPostedMenu] = useState(false);
  const hasKcal = Boolean(values.kcal?.trim()) && Number(values.kcal) >= 0;
  const saved = initialName === undefined ? title : name;
  const save = useMutation({
    networkMode: "always",
    mutationFn: () =>
      enqueueNumbers(
        replay,
        person,
        saved,
        values,
        required,
        eatingOut,
        hasKcal && postedMenu,
      ),
    onSuccess: () => {
      setValues(empty());
      setEatingOut(false);
      setPostedMenu(false);
      done(saved.trim());
    },
  });
  const prefix = title.toLowerCase().replace(" ", "-");
  return (
    <form
      aria-label={title}
      className="block max-w-none rounded-(--radius) border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset
        disabled={save.isPending}
        className="m-0 grid gap-3 border-0 p-0"
      >
        {initialName !== undefined && (
          <>
            <legend className="mb-3 p-0 text-(length:--step-2) font-semibold">
              {title}
            </legend>
            <label
              htmlFor={`${prefix}-name`}
              className="grid gap-1.5 text-sm font-medium"
            >
              Name
              <Input
                id={`${prefix}-name`}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </>
        )}
        <EatingOutSwitch checked={eatingOut} eligible onChange={setEatingOut} />
        <label
          className={cn(
            "flex items-center gap-2 text-sm",
            !hasKcal && "invisible",
          )}
        >
          <input
            type="checkbox"
            data-slot="checkbox"
            className="size-4 shrink-0 accent-accent"
            checked={hasKcal && postedMenu}
            onChange={(event) => setPostedMenu(event.target.checked)}
          />
          Posted menu kcal
        </label>
        <div className="grid grid-cols-2 gap-3">
          {nutrients.map((key) => {
            const [label, unit] = fieldNames[key];
            const needed = required.includes(key);
            return (
              <label
                key={key}
                htmlFor={`${prefix}-${key}`}
                className={cn(
                  "grid gap-1.5 text-sm font-medium",
                  key === "kcal" && "col-span-2",
                )}
              >
                <span>
                  {label}{" "}
                  <em className="text-xs font-normal not-italic text-ink-2">
                    ({unit}, {needed ? "required" : "optional"})
                  </em>
                </span>
                <Input
                  id={`${prefix}-${key}`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  required={needed}
                  className="numeric"
                  value={values[key]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValues({ ...values, [key]: value });
                    if (key === "kcal" && value === "") setPostedMenu(false);
                  }}
                />
              </label>
            );
          })}
        </div>
        <Button type="submit" size="lg" className={cn(press, "mt-2 w-full")}>
          Log food
        </Button>
      </fieldset>
      {save.isError && <p role="alert">Couldn’t log food</p>}
    </form>
  );
}
