import { type FormEvent, useState } from "react";
import {
  editorAfterChange,
  removableFields,
  saveEntry,
} from "./outbox-edit.ts";
import type { OutboxReplay } from "./outbox-replay.ts";
import type { EntryBody, JsonValue, QueueEntry } from "./outbox-store.ts";

const textFields = new Set([
  "name",
  "source",
  "provenance",
  "portion_note",
  "eaten_at",
  "measured_at",
]);
const label = (name: string) => name.replaceAll("_", " ");
const inputValue = (value: JsonValue) =>
  typeof value === "string" ? value : JSON.stringify(value);
function Values({ body }: { body: EntryBody }) {
  return (
    <dl>
      {Object.entries(body)
        .filter(([name]) => name !== "client_id")
        .map(([name, value]) => (
          <div key={name}>
            <dt>{label(name)}</dt>
            <dd>
              {typeof value === "object"
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
}: {
  entries: QueueEntry[];
  replay: OutboxReplay;
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
                entry={entry}
                busy={busy}
                save={(patch) =>
                  change(entry, () => saveEntry(replay, entry, patch))
                }
                cancel={() => setEditing(null)}
              />
            ) : (
              <>
                <Values body={entry.body} />
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
                <Values body={entry.server_row} />
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
}: {
  entry: QueueEntry;
  busy: boolean;
  save: (patch: Record<string, JsonValue | undefined>) => Promise<void>;
  cancel: () => void;
}) {
  const fields = Object.entries(entry.body).filter(
    ([name]) => name !== "client_id",
  );
  const [values, setValues] = useState<Record<string, string | undefined>>(() =>
    Object.fromEntries(
      fields.map(([name, value]) => [name, inputValue(value)]),
    ),
  );
  const [error, setError] = useState("");
  const removable = removableFields(
    entry.kind,
    Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        value === "null" ? null : value,
      ]),
    ),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const patch: Record<string, JsonValue | undefined> = {};
      for (const [name, original] of fields) {
        const value = values[name];
        if (value === undefined) patch[name] = undefined;
        else if (typeof original === "string" || textFields.has(name))
          patch[name] = value;
        else patch[name] = JSON.parse(value);
      }
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
          <label htmlFor={`entry-${entry.seq}-${name}`}>{label(name)}</label>
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
                      ? inputValue(original)
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
