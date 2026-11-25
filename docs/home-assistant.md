# Connect Home Assistant

Tare publishes its numbers to Home Assistant through an MQTT broker using MQTT discovery. Home Assistant shows them as one Tare device for the account, with sensors, `target_changed` and activity events, and a pair of buttons for each meal on hand.

## Set up the broker and Tare

Compose runs only Tare, not an MQTT broker. Use the broker Home Assistant already talks to, for example the Mosquitto add-on, and create a separate broker user for Tare with that broker's own instructions. Connect Home Assistant's MQTT integration to the same broker.

Set these in the private `.env` file described in [Deploy Tare](deploy.md). `.env.example` and `compose.example.yaml` already list them, and the [environment reference](deploy.md#environment-reference) gives every rule.

```dotenv
TARE_MQTT_URL=mqtt://broker.example.test:1883
TARE_MQTT_USERNAME=tare
TARE_MQTT_PASSWORD=replace-with-the-broker-password
```

- `TARE_MQTT_URL` takes only the scheme, host and port. Credentials, a path, a query or a fragment in the URL prevent startup. Use `mqtts://` for TLS.
- Put the broker user in `TARE_MQTT_USERNAME` and `TARE_MQTT_PASSWORD`. Set both or neither.
- Leave `TARE_MQTT_URL` empty to turn the publisher off.
- Change `TARE_HA_DISCOVERY_PREFIX` or `TARE_HA_STATUS_TOPIC` only if you changed them in Home Assistant's MQTT settings.

Recreate the Tare container to load the new settings, with `down` and then `up --detach --wait` as in [Deploy Tare](deploy.md); `docker compose restart` keeps the old settings. A broker that is down does not stop Tare from starting; it connects when the broker comes back.

## What Tare publishes

The device is named `Tare <username>`. Every entity on it goes unavailable when Tare stops.

| Entity | Unit | What it shows |
| --- | --- | --- |
| Calorie target | kcal | Today's calorie target. |
| Protein target | g | Today's protein target. |
| Calories remaining | kcal | Target minus what you have eaten today. |
| Protein remaining | g | Protein target minus protein eaten today. |
| Calories eaten today | kcal | Sum of today's entries with a known calorie value. Attribute `complete` is false while any entry is missing one. |
| Protein eaten today | g | The same for protein, with its own `complete` attribute. |
| Weight trend | kg | The latest smoothed weight. |
| TDEE estimate | kcal | The latest adaptive estimate of daily energy use. |
| Target changed | event | Fires when a recompute changes the stored target. Attributes `old_kcal`, `old_protein_g`, `new_kcal` and `new_protein_g`. |
| Activity | event | Fires once for each food, dose, weight or workout you log. See [Activity events](#activity-events). |
| `<meal> ate it`, `<meal> ate 3/4` | button | One pair per meal on hand. Pressing one logs that portion. |
| Last meal press | | Result of the last button press: `logged`, `stale_revision`, `invalid_press` or another error code, with `meal_id`, `action` and `at` attributes. Shows `none` until the first press since Tare started. |
| Workout today | | Today's session name, or the cardio or rest label. Shows `No schedule` until a schedule is stored. Attributes `today` (the entry with its movements) and `week`. |

A number can be unknown: no target until the profile is set up and there is a first weigh-in, no remaining value while any entry today lacks a value, no trend without weigh-ins, no TDEE estimate until there is enough signed-off history. Home Assistant shows these as `unknown`. Do not treat unknown as zero in templates or automations.

Meal buttons come and go. A meal gets its pair when it is delivered or due today, and loses it when its last serving is eaten. Each press carries the meal's revision. A press sent again with the same revision, such as a double press, logs nothing and reports `logged` again. Any other press with an old revision logs nothing and reports `stale_revision`. A meal whose nutrition is not known yet still has buttons, but a press logs nothing and reports `meal_nutrition_pending` or `meal_nutrition_missing` until you answer its nutrition question in Tare.

`target_changed` and activity events are not replayed after a restart. A change that happened while Home Assistant was offline appears in Tare but does not fire the event later.

## Find the entity ids

Tare suggests ids built from the username, such as `sensor.tare_alex_calorie_target`. Home Assistant keeps its own entity registry and may choose a different id, for example after a rename or a clash. Copy the ids from Settings > Devices & services > MQTT > `Tare <username>`.

## Example dashboard

[`home-assistant-dashboard.yaml`](home-assistant-dashboard.yaml) is a dashboard built only from core cards. Every id in it uses the placeholder `example`, as in `sensor.tare_example_calorie_target`. Replace each one with the id from your device page.

To use it as a YAML dashboard, copy the file into your Home Assistant configuration folder and add it to `configuration.yaml`:

```yaml
lovelace:
  dashboards:
    tare-food:
      mode: yaml
      title: Tare
      icon: mdi:scale-bathroom
      filename: home-assistant-dashboard.yaml
```

Restart Home Assistant to load it. Alternatively, create a dashboard in the interface, open its raw configuration editor and paste the file in.

The meal buttons sit in an entity filter card that hides ids Home Assistant does not know. List the ids of the meals you expect; any meal without buttons stays hidden. To show new meals without editing the dashboard, the community `auto-entities` card can match `button.tare_example_meal_*` instead.

## Activity events

The Activity entity fires one of these event types, with these attributes. Notes and descriptions are never included.

| Event type | Attributes |
| --- | --- |
| `food_logged` | `name`, `kcal`, `protein_g`, `slot` (the meal slot name, or none) |
| `dose_logged` | `medication`, `status` (`taken` or `skipped`) |
| `weight_logged` | `kg` |
| `workout_logged` | `kind`, `duration_minutes` (none for a workout logged by date only) |

Each record fires once, when it is logged. Editing or deleting it fires nothing, and a record deleted before Home Assistant receives its event never fires. Undoing a dose fires nothing; logging that dose again fires a new `dose_logged`. Stopping a medication skips its open doses without firing. Workouts imported from Oura fire when they first arrive, so the first sync after connecting Oura fires one `workout_logged` for each workout in its 30-day backfill. A meal logged in several parts fires one `food_logged` per part.

The examples below use the placeholder `example`. Replace the ids with the ones on your device page and `notify.mobile_app_example` with your phone's notification action.

A protein reminder at 8 PM when more than 40 g is left. It uses the Protein remaining sensor, not an event:

```yaml
alias: Tare protein reminder
triggers:
  - trigger: time
    at: "20:00:00"
conditions:
  - condition: numeric_state
    entity_id: sensor.tare_example_protein_remaining
    above: 40
actions:
  - action: notify.mobile_app_example
    data:
      title: Protein
      message: "{{ states('sensor.tare_example_protein_remaining') | round(0) }} g left today"
```

A chime when a dose is taken. Replace the media player and sound with your own; a light can flash instead with `light.turn_on` and `flash: short`:

```yaml
alias: Tare dose chime
triggers:
  - trigger: state
    entity_id: event.tare_example_activity
    not_from: unavailable
conditions:
  - condition: template
    value_template: >
      {{ trigger.to_state.attributes.event_type == 'dose_logged'
         and trigger.to_state.attributes.status == 'taken' }}
actions:
  - action: media_player.play_media
    target:
      entity_id: media_player.example_speaker
    data:
      media_content_id: media-source://media_source/local/chime.mp3
      media_content_type: music
```

A logbook entry for each workout:

```yaml
alias: Tare workout log
triggers:
  - trigger: state
    entity_id: event.tare_example_activity
    not_from: unavailable
conditions:
  - condition: template
    value_template: "{{ trigger.to_state.attributes.event_type == 'workout_logged' }}"
actions:
  - action: logbook.log
    data:
      name: Workout
      message: >
        {{ trigger.to_state.attributes.kind }}
        {%- if trigger.to_state.attributes.duration_minutes %},
        {{ trigger.to_state.attributes.duration_minutes }} min{% endif %}
      entity_id: event.tare_example_activity
```

An event entity's state changes each time it fires, so a state trigger on it runs once per event. Keep `not_from: unavailable` in the trigger: when Tare or Home Assistant restarts, the entity comes back from `unavailable` with the last event's attributes, and without it the automation runs again for an old event.

## Medication reminders

Tare publishes a sensor for each active medication. Its suggested entity ID starts with `sensor.tare_example_medication_`, where `example` is the account slug. Check the first sensor's ID on the device page and use that prefix for the automation. The prefix matches medications added later.

The example below sends a mobile notification when a sensor becomes due or late, changes dose key while due or late, or reports more late doses. Replace `notify.mobile_app_example` with your phone's notification action.

```yaml
alias: Tare medication reminder
triggers:
  - trigger: event
    event_type: state_changed
conditions:
  - condition: template
    value_template: >
      {% set event = trigger.event.data %}
      {% set before = event.old_state %}
      {% set after = event.new_state %}
      {{ event.entity_id.startswith('sensor.tare_example_medication_')
         and after is not none
         and (
           (after.state in ['due', 'late'] and
            (before is none or before.state != after.state or
             before.attributes.get('next_dose_key') != after.attributes.get('next_dose_key')))
           or after.attributes.get('late_count', 0) >
              (before.attributes.get('late_count', 0) if before else 0)
         ) }}
actions:
  - variables:
      dose_key: "{{ trigger.event.data.new_state.attributes.get('next_dose_key') }}"
      can_log: "{{ trigger.event.data.new_state.state in ['due', 'late'] and dose_key is not none }}"
  - action: notify.mobile_app_example
    data:
      title: "{{ trigger.event.data.new_state.name }}"
      message: "{{ 'Dose due' if trigger.event.data.new_state.state == 'due' else 'Late dose' }}"
      data:
        actions: "{{ [{'action': 'TARE_DOSE_' ~ dose_key, 'title': 'Log dose'}] if can_log else [] }}"
```

Add a second automation to send the dose key captured by the notification button. In the command topic, replace `<install>` and `<user_id>` with the first two levels after `tare/` in the sensor's discovery `state_topic`.

```yaml
alias: Log a Tare medication dose
triggers:
  - trigger: event
    event_type: mobile_app_notification_action
conditions:
  - condition: template
    value_template: "{{ trigger.event.data.action.startswith('TARE_DOSE_') }}"
actions:
  - action: mqtt.publish
    data:
      topic: tare/<install>/<user_id>/medication_press
      payload: "{{ {'dose_key': trigger.event.data.action[10:]} | tojson }}"
      qos: 1
      retain: false
```

Tare ignores the button once the dose is no longer due or late. Changing which dose the sensor shows never changes the key on a notification already sent.

## Replay and copies

Discovery and state messages are retained on the broker. Tare publishes all of them again whenever it connects to the broker and whenever Home Assistant announces it is online on the status topic, so a restart of either side restores every entity.

Tare stores an install id in its database and uses it in topics, device ids and as its MQTT client id. A copy of the database, such as a restored backup started next to the original, has the same install id. Never connect two Tare instances started from one database to the same broker: they publish over each other and the broker disconnects one when the other connects.

## Trust

Anyone who can use your Home Assistant can press your Tare buttons. A press logs food on your Tare account without signing in to Tare. Give Home Assistant access only to people you would trust to log your meals, and check Last meal press if an entry looks wrong.

Medication names and dose status are retained MQTT messages. Anyone with read access to the broker topics or the Home Assistant device can see them. Anyone who can publish to the medication command topic can mark a due or late dose taken.

Products found through food lookups (USDA and Open Food Facts) are cached once for the whole install. The cache does not record who looked a product up, though each product keeps the time it was retrieved. Your own foods, meals and intake stay with your account.
