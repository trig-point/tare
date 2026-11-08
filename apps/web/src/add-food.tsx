import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Session } from "./api.ts";
import {
  type CatalogResult,
  catalogQuery,
  enqueueFood,
  enqueueNumbers,
  type FoodChoice,
  mergeChoices,
  searchOnline,
} from "./food-api.ts";
import type { OutboxReplay } from "./outbox-replay.ts";
import { displayNumber, nutrientLabels, nutrients } from "./today-api.ts";

type Props = {
  person: Session["user"];
  replay: OutboxReplay;
  online: boolean;
};

export function AddFood({ person, replay, online }: Props) {
  const [name, setName] = useState("");
  const [servings, setServings] = useState("1");
  const [manual, setManual] = useState<string | null>(null);
  const term = name.trim();
  const catalog = useQuery({
    ...catalogQuery(person.id, name),
    enabled: online && term !== "",
  });
  const lookup = useMutation({ mutationFn: searchOnline, retry: 0 });
  const log = useMutation({
    networkMode: "always",
    mutationFn: (food: FoodChoice) =>
      enqueueFood(replay, person, food, servings),
    onSuccess: () => {
      setName("");
      setServings("1");
      lookup.reset();
    },
  });
  const searched = lookup.variables === term ? lookup : undefined;
  const choices = mergeChoices(
    catalog.data?.result === "match" ? catalog.data.foods : [],
    searched?.data ?? [],
  );
  const catalogMissed =
    term !== "" &&
    catalog.data !== undefined &&
    catalog.data.result !== "match";
  return (
    <div className="add-food">
      <h2>Add food</h2>
      <label htmlFor="food-search">Food</label>
      <input
        id="food-search"
        type="search"
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {term !== "" && !online && <p>Search unavailable offline</p>}
      {catalog.isError && <p role="alert">Couldn’t search foods</p>}
      {term !== "" && catalog.data && (
        <CatalogMiss
          result={catalog.data.result}
          enterManually={() => setManual(term)}
        />
      )}
      {term !== "" && online && (
        <button
          type="button"
          disabled={lookup.isPending}
          onClick={() => lookup.mutate(term)}
        >
          Search online
        </button>
      )}
      {searched?.isPending && <p>Searching...</p>}
      {searched?.isError && <p role="alert">Couldn’t search online</p>}
      {searched?.data?.length === 0 && (
        <OnlineMiss
          enterManually={catalogMissed ? undefined : () => setManual(term)}
        />
      )}
      {choices.length > 0 && (
        <>
          <label htmlFor="food-servings">Servings</label>
          <input
            id="food-servings"
            type="number"
            min="0.01"
            step="any"
            required
            value={servings}
            onChange={(event) => setServings(event.target.value)}
          />
          <ul className="entries" aria-label="Matches">
            {choices.map((food) => (
              <li key={`${food.reference.kind}-${food.reference.id}`}>
                <strong>{food.name}</strong>
                {food.brand && <span>{food.brand}</span>}
                {food.serving && <span>{food.serving}</span>}
                {food.kcal !== null && (
                  <span>{displayNumber(food.kcal)} kcal</span>
                )}
                <button
                  type="button"
                  aria-label={`Log ${food.name}`}
                  disabled={log.isPending}
                  onClick={() => log.mutate(food)}
                >
                  Log
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {log.isError && <p role="alert">Couldn’t log food</p>}
      {manual !== null && (
        <NumbersForm
          key={manual}
          title="Enter manually"
          initialName={manual}
          fields={nutrients}
          person={person}
          replay={replay}
          done={() => {
            setManual(null);
            setName("");
          }}
        />
      )}
      <NumbersForm
        title="Quick add"
        fields={["kcal", "protein_g"]}
        person={person}
        replay={replay}
      />
    </div>
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
  return (
    <p>
      No match{" "}
      <button type="button" onClick={enterManually}>
        Enter manually
      </button>
    </p>
  );
}

export function OnlineMiss({ enterManually }: { enterManually?: () => void }) {
  return (
    <p>
      No exact match{" "}
      {enterManually && (
        <button type="button" onClick={enterManually}>
          Enter manually
        </button>
      )}
    </p>
  );
}

function NumbersForm({
  title,
  initialName,
  fields,
  person,
  replay,
  done,
}: {
  title: string;
  initialName?: string;
  fields: readonly (typeof nutrients)[number][];
  person: Session["user"];
  replay: OutboxReplay;
  done?: () => void;
}) {
  const empty = () => Object.fromEntries(fields.map((key) => [key, ""]));
  const [name, setName] = useState(initialName ?? "");
  const [values, setValues] = useState<Record<string, string>>(empty);
  const save = useMutation({
    networkMode: "always",
    mutationFn: () =>
      enqueueNumbers(
        replay,
        person,
        initialName === undefined ? title : name,
        values,
      ),
    onSuccess: () => {
      setValues(empty());
      done?.();
    },
  });
  const prefix = title.toLowerCase().replace(" ", "-");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>{title}</legend>
        {initialName !== undefined && (
          <label>
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        {fields.map((key) => (
          <label key={key} htmlFor={`${prefix}-${key}`}>
            {nutrientLabels[key]}
            <input
              id={`${prefix}-${key}`}
              type="number"
              min="0"
              step="any"
              value={values[key]}
              onChange={(event) =>
                setValues({ ...values, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <button type="submit">Log</button>
      </fieldset>
      {save.isError && <p role="alert">Couldn’t log food</p>}
    </form>
  );
}
