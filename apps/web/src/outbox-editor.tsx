import { type FormEvent, useState } from "react";
import { type BodyUnits, formatBodyWeight, weightUnit } from "./body-units.ts";
import {
  type EditorValues,
  editorAfterChange,
  editorInput,
  editorPatch,
  removableFields,
  saveEntry,
} from "./outbox-edit.ts";
import type { OutboxReplay } from "./outbox-replay.ts";
import type { EntryBody, JsonValue, QueueEntry } from "./outbox-store.ts";

const label = (name: string) => name.replaceAll("_", " ");
const fieldLabel = (name: string, units: BodyUnits) =>
  name === "weight_kg" ? `Weight (${weightUnit(units)})` : label(name);
function Values({ body, units }: { body: EntryBody; units: BodyUnits }) {
  return (
    <dl>
      {Object.entries(body)
        .filter(([name]) => name !== "client_id")
        .map(([name, value]) => (
          <div key={name}>
            <dt>{fieldLabel(name, units)}</dt>
            <dd>
              {name === "weight_kg" && typeof value === "number"
                ? formatBodyWeight(value, units)
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function RejectedEntries({
  entries,
  replay,
  units,
}: {
  entries: QueueEntry[];
  replay: OutboxReplay;
  units: BodyUnits;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(entry: QueueEntry, work: () => Promise<boolean>) {
    setBusy(true);
    setError("");
    try {
      if (await work())
        setEditing((current) => editorAfterChange(current, entry.seq));
      else setError("This entry changed");
    } catch {
      setError("Couldn’t update entry");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rejected-entries">
      {error && <p role="alert">{error}</p>}
      {entries
        .filter((entry) => entry.state === "rejected")
        .map((entry) => (
          <article key={entry.seq}>
            <h2>{entry.kind === "intake" ? "Food entry" : "Weight entry"}</h2>
            <p>{label(entry.error_code ?? "rejected")}</p>
            {editing === entry.seq && entry.error_code !== "already_saved" ? (
              <EntryEditor
                key={`${entry.seq}:${entry.revision}`}
                preferredUnits={units}
                entry={entry}
                busy={busy}
                save={(patch) =>
                  change(entry, () => saveEntry(replay, entry, patch))
                }
                cancel={() => setEditing(null)}
              />
            ) : (
              <>
                <Values body={entry.body} units={units} />
                {entry.error_code !== "already_saved" && (
                  <div className="actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing(entry.seq)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void change(entry, () => replay.resend(entry))
                      }
                    >
                      Resend
                    </button>
                  </div>
                )}
              </>
            )}
            {entry.server_row && (
              <details>
                <summary>Saved entry</summary>
                <Values body={entry.server_row} units={units} />
              </details>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Discard this entry?"))
                  void change(entry, () => replay.discard(entry));
              }}
            >
              Discard
            </button>
          </article>
        ))}
    </div>
  );
}
function EntryEditor({
  entry,
  busy,
  save,
  cancel,
  preferredUnits,
}: {
  entry: QueueEntry;
  busy: boolean;
  save: (patch: Record<string, JsonValue | undefined>) => Promise<void>;
  cancel: () => void;
  preferredUnits: BodyUnits;
}) {
  const [units] = useState(preferredUnits);
  const fields = Object.entries(entry.body).filter(
    ([name]) => name !== "client_id",
  );
  const [values, setValues] = useState<EditorValues>(() =>
    Object.fromEntries(
      fields.map(([name, value]) => [name, editorInput(name, value, units)]),
    ),
  );
  const [error, setError] = useState("");
  const removable = removableFields(entry.kind, values);
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const patch = editorPatch(entry.body, values, units);
      setError("");
      void save(patch);
    } catch {
      setError("Check the values");
    }
  }
  return (
    <form onSubmit={submit}>
      {fields.map(([name, original]) => (
        <div key={name}>
          <label htmlFor={`entry-${entry.seq}-${name}`}>
            {fieldLabel(name, units)}
          </label>
          <input
            id={`entry-${entry.seq}-${name}`}
            value={values[name] ?? ""}
            disabled={busy || values[name] === undefined}
            required={name === "eaten_at" || name === "measured_at"}
            onChange={(event) =>
              setValues({ ...values, [name]: event.target.value })
            }
          />
          {(values[name] === undefined || removable.has(name)) && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setValues({
                  ...values,
                  [name]:
                    values[name] === undefined
                      ? editorInput(name, original, units)
                      : undefined,
                })
              }
            >
              {values[name] === undefined ? "Restore" : "Remove"}
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          Save and resend
        </button>
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
