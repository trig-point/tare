# Build workouts with your agent

This guide is for a person running their own Tare with their own agent. The agent reads your training data from Tare, then writes your places, machines, limits, movement cards and weekly schedule back through MCP. Tare stores what the agent writes and shows it. It does not seed any training data or choose workouts; building the plan is the agent's job.

Every example uses made-up data. Names, places and dates are placeholders.

## Connect the agent

The training tools are MCP tools, served at `/mcp`. MCP works only in Cloudflare Access mode, and the agent signs in with a service token that an administrator has mapped to your Tare person. See [Deploy Tare](deploy.md#https-and-login-mode) for Access mode and the Add an agent form in Settings. Every call below acts on the person the token is mapped to.

## Read first: `get_training_context`

Call `get_training_context` before writing anything. It takes no arguments.

```json
{}
```

One call returns:

| Field | What it holds | What it is for |
| --- | --- | --- |
| `places` | Each training place, with its `machines` nested inside. | What equipment exists where. |
| `limits` | Active limits only. Resolved limits are left out. | Movements to avoid or modify. |
| `schedule` | The stored weekly schedule, or `null`. Each session also carries a read-only `place` (`id`, `name` and `notes`): the matching place, or `null`. | What is planned now, and where. |
| `recent_sessions` | The last five sessions you or your agent logged, with their sets. Workouts synced from a tracker are not included. | Current loads and what you have actually done. |

A session's `place` is found by matching the session's `where` text to a place name, ignoring case and surrounding spaces. It is `null` when no place matches or when two places share the name. Keep place names unique. The `place` field exists only in this read. `replace_workout_schedule` rejects it, so to edit the schedule start from `read_workout_schedule`, not from `get_training_context`.

## Write places and machines

A place is a location you train at. A machine belongs to one place and lists the movements it supports. Tare keeps no fixed equipment list; the agent creates the records, for example after you name a machine or send a photo.

`save_training_place` takes `name` (up to 80 characters) and `notes` (up to 1000, or `null`). It returns the place with its `id`. A create that times out may still have saved, so read the context before you try again, or you may create a duplicate.

```json
{ "name": "Home", "notes": "Garage corner, dumbbells and one bench." }
```

`save_training_machine` takes `place_id`, `name` (up to 80), `notes`, `movements` (up to 50 names, each up to 160 characters) and `photo_urls` (up to 10 http or https URLs).

```json
{
  "place_id": 2,
  "name": "Adjustable bench",
  "notes": "Flat to 80 degrees.",
  "movements": ["Incline dumbbell press", "Chest-supported row"],
  "photo_urls": []
}
```

On a create, `notes`, `movements` and `photo_urls` may be left out and become empty. Saves do not check whether the record changed since you read it, so read it again just before you replace it. To replace a record, send its `id`:

- Replacing a place requires `notes`; send `null` to clear them.
- Replacing a machine requires `notes`, `movements` and `photo_urls`. Send the whole record, because a replace never merges.
- A machine's `place_id` must exist, or the call fails with `place_not_found`.

`remove_training_machine`, `remove_training_place` and `remove_training_limit` take only an `id`. Removing a place removes all of its machines.

```json
{ "id": 3 }
```

## Write limits

A limit records an injury or restriction. `save_training_limit` takes `body_area` (up to 120 characters), `description` (up to 1000), `movements` (the movements it affects, up to 50), `status` (`active` or `resolved`) and `date_noted` (a `YYYY-MM-DD` date). All five fields are required.

```json
{
  "body_area": "Left shoulder",
  "description": "Pinches when pressing overhead. Fine below shoulder height.",
  "movements": ["Overhead press", "Lateral raise"],
  "status": "active",
  "date_noted": "2026-11-02"
}
```

To resolve a limit, save it again with its `id` and `status` set to `resolved`, keeping the other fields. A resolved limit stays stored but no longer appears in `get_training_context`.

## Write movement cards

A movement card is the how-to for one movement. `save_movement` takes:

| Field | Rule |
| --- | --- |
| `name` | Required, up to 80 characters. This is the key: a card with the same name is replaced. Case is ignored for the letters A to Z only, so keep accented names spelled and cased the same everywhere. |
| `setup`, `cues`, `mistakes`, `safety` | Ordered lists of up to 20 steps, each up to 300 characters. |
| `pictures` | Up to 10 http or https URLs. |
| `rest_seconds` | Whole seconds from 0 to 3600, or `null`. |
| `source` | Where the card came from, up to 200 characters, or `null`. |
| `equipment` | Free text, up to 300 characters, or `null`. |

```json
{
  "name": "Incline dumbbell press",
  "setup": ["Set the bench to 30 degrees.", "Sit with a dumbbell on each thigh and kick them up."],
  "cues": ["Shoulder blades back and down.", "Elbows about 45 degrees from the torso."],
  "mistakes": ["Flaring the elbows wide."],
  "safety": ["Lower the weights to the floor from the sides, not over the face."],
  "pictures": [],
  "rest_seconds": 120,
  "source": "free-exercise-db",
  "equipment": "Dumbbells, adjustable bench"
}
```

A save replaces the whole card, and any field you leave out is cleared. To change one step, read the card with `get_movement`, edit it and send back every writable field. Leave out `id` and `sessions`, which `save_movement` rejects.

The other tools:

- `list_movements` takes no arguments (`{}`) and returns every card.
- `get_movement` takes a `name`, matched the same way as a card name, and fails with `not_found` when there is none. It returns `{ "movement": { ... } }`; edit the inner object.
- `remove_movement` takes a `name`.

```json
{ "name": "Incline dumbbell press" }
```

Every card also returns `sessions`: the number of logged sessions that have at least one set with that exercise name, matched the same way as a card name. It counts sessions, not sets. Log sets under the same name the card uses, and keep card names to 80 characters, the limit for an exercise name on a logged set.

## Write the schedule

`read_workout_schedule` takes no arguments (`{}`) and returns `{ "schedule": { ... } }`, with `null` inside before the first write. Edit the inner object and send that, with its `updated` stamp, to `replace_workout_schedule`; do not send the outer `schedule` key. `replace_workout_schedule` replaces the whole document. It cannot patch one day.

The document has these parts:

- `version`: always `1`.
- `timezone`: an IANA zone such as `America/New_York`. Offsets such as `UTC+5` are refused. Optional `updated_by` (up to 80 characters) says who wrote it.
- `week`: all seven days, `mon` to `sun`. Each is a lift (`{"kind": "lift", "session": "<key or group>"}`) or a `cardio` or `rest` day with a `label`.
- `sessions`: the session library, keyed by a lowercase key such as `upper_gym`. Each session has `name`, `where`, an optional `note`, and up to 30 `movements`. A movement has `name`, `sets` (1 to 20) and `reps`, plus optional `load`, `rir`, `rest_s` and `note`. `sets` is a whole number; `reps` and the optional fields are text, so send `"10"`, not `10`.
- `rotation`: the order sessions come up, as session keys.
- `next_session`: the session key due next, or `null`.
- `planned`: dated entries that override the week for one day. Each has a `date` and either a `session` or a `cardio` or `rest` kind with a `label`. Up to 400, one per date.

A week lift day names a session key or a group. If the name is an exact session key, that session is used. Otherwise it is a group: the text before the first underscore, so `upper` covers `upper_gym` and `upper_home`. A group needs at least one member in `rotation`. On a group day, Tare picks `next_session` if it is in the group, and otherwise the first group session in `rotation`. Tare never advances `next_session` or the rotation after a workout, so the agent rewrites `next_session` each time it should move on. A dated lift entry always names one exact session key; a dated `cardio` or `rest` entry has a `label` instead.

The session's `where` should be the name of a place from `places` (up to 80 characters), spelled the same apart from case and surrounding spaces. That is how `get_training_context` finds the session's place; the place's machines are in `places`.

Two rules apply to every write:

- Send back the `updated` value you last read. Leave it out only for the first write. A stale or missing value fails with `schedule_conflict`. Read the schedule again, apply your changes to that new copy, and send it with its `updated`. Resending your old document with only a new `updated` erases the other writer's edits.
- The document, without `updated`, may be at most 60,000 bytes, or the call fails with `schedule_too_large`. A request body over 65,536 bytes fails earlier with `body_too_large`.

A bad document comes back as an error whose text lists what is wrong, such as `unknown session upper_x`, `duplicate date 2026-12-07` or `no upper in rotation`. Fix every message and send it again.

`today_workout` takes no arguments (`{}`) and returns `{ "today": { ... } }`, where `today` is `null` when no schedule is stored. The entry is the dated one if there is one, otherwise the week day. Today is the date in your Tare account's time zone, using your day start hour; the schedule's own `timezone` field does not change it. Each movement comes with its `card`, the library card with the same name, or `null` when no card matches. Schedule movement names go up to 120 characters but cards stop at 80, so keep scheduled names short enough to match.

## Worked flow: a session moves from the gym to home

Your Monday session is `upper_gym` at the downtown gym. The gym slot is missed, so the session happens at home in the evening. The agent should keep to your limits and the equipment at home.

1. Call `get_training_context` with `{}`. In `places`, Home has one machine, the adjustable bench, which supports `Incline dumbbell press` and `Chest-supported row`. In `limits`, one active limit lists `Overhead press`. In `schedule`, `upper_gym` has `Overhead press` in it.
2. Check each movement in `upper_gym` against the Home machines and the limit. Drop `Overhead press` because of the limit. Keep the movements the bench supports.
3. Call `list_movements` with `{}` to see which names already have a card. For a movement with no card, call `save_movement`, as in the card example above.
4. Call `read_workout_schedule` with `{}` to get the writable document and its `updated` stamp. Do not edit the schedule from the context read: its sessions carry `place` fields that a replace rejects.
5. In that document, add an `upper_home` session and a dated entry that points Monday, `2026-12-07`, at it. The week template stays the same, so the next Monday is back at the gym.
6. Call `replace_workout_schedule` with the full document and the `updated` value from step 4.
7. Call `today_workout` with `{}` on that Monday, by your account's date. It returns the `upper_home` session, each movement with its `card`.

The arguments for step 6:

```json
{
  "version": 1,
  "updated": "2026-11-30T14:05:00.000Z",
  "timezone": "America/New_York",
  "week": {
    "mon": { "kind": "lift", "session": "upper" },
    "tue": { "kind": "rest", "label": "Rest" },
    "wed": { "kind": "lift", "session": "lower" },
    "thu": { "kind": "cardio", "label": "Easy bike, 30 min" },
    "fri": { "kind": "lift", "session": "upper" },
    "sat": { "kind": "rest", "label": "Rest" },
    "sun": { "kind": "rest", "label": "Rest" }
  },
  "rotation": ["upper_gym", "lower_gym"],
  "next_session": "upper_gym",
  "planned": [{ "date": "2026-12-07", "session": "upper_home" }],
  "sessions": {
    "upper_gym": {
      "name": "Upper",
      "where": "Downtown Gym",
      "movements": [
        { "name": "Overhead press", "sets": 3, "reps": "8", "rir": "2" },
        { "name": "Incline dumbbell press", "sets": 3, "reps": "10" },
        { "name": "Chest-supported row", "sets": 3, "reps": "10" }
      ]
    },
    "upper_home": {
      "name": "Upper (home)",
      "where": "Home",
      "note": "No overhead pressing while the shoulder limit is active.",
      "movements": [
        { "name": "Incline dumbbell press", "sets": 3, "reps": "10", "rest_s": "120" },
        { "name": "Chest-supported row", "sets": 3, "reps": "10" }
      ]
    },
    "lower_gym": {
      "name": "Lower",
      "where": "Downtown Gym",
      "movements": [
        { "name": "Back squat", "sets": 4, "reps": "6", "load": "60 kg" }
      ]
    }
  }
}
```

## How the app uses the cards

Select Start on the Body tab to open today's workout guide. A movement with three or more logged sessions opens in the short view (`SHORT_CARD_SESSIONS`), and marking a set done starts the card's rest timer or a 90-second timer if no rest is set.

## Optional reference data

Two open datasets can help an agent write cards. Tare does not bundle, import or require either.

- [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense): exercise instructions and about 1,700 images. A good source for `pictures`.
- [exercises-json](https://github.com/kinetic-place/exercises-json) (MIT): setup steps, form cues and common mistakes for many exercises. It is a young project, so pin a version.

Do not copy from wger (CC-BY-SA, share-alike) or ExerciseDB (AGPL or paid); their licenses place conditions on reuse that Tare does not take on.
