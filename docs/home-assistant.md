# Connect Home Assistant

Tare publishes its numbers to Home Assistant through an MQTT broker using MQTT discovery. Home Assistant shows them as one Tare device for the account, with sensors, a `target_changed` event and a pair of buttons for each meal on hand.

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

Restart Tare. A broker that is down does not stop Tare from starting; it connects when the broker comes back.

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
| `<meal> ate it`, `<meal> ate 3/4` | button | One pair per meal on hand. Pressing one logs that portion. |
| Last meal press | | Result of the last button press: `logged`, `stale_revision`, `invalid_press` or another error code, with `meal_id`, `action` and `at` attributes. Shows `none` until the first press. |

A number can be unknown: no target before the profile is set up, no remaining value while any entry today lacks a value, no trend without weigh-ins, no TDEE estimate until there is enough signed-off history. Home Assistant shows these as `unknown`. Do not treat unknown as zero in templates or automations.

Meal buttons come and go. A meal gets its pair when it is delivered or due today, and loses it when its last serving is eaten. Each press carries the meal's revision, so pressing a button that an earlier press made stale does nothing and reports `stale_revision`.

`target_changed` is not replayed after a restart. A change that happened while Home Assistant was offline appears in Tare but does not fire the event later.

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

## Replay and copies

Discovery and state messages are retained on the broker. Tare publishes all of them again whenever it connects to the broker and whenever Home Assistant announces it is online on the status topic, so a restart of either side restores every entity.

Tare stores an install id in its database and uses it in topics, device ids and as its MQTT client id. A copy of the database, such as a restored backup started next to the original, has the same install id. Never connect two Tare instances started from one database to the same broker: they publish over each other and the broker disconnects one when the other connects.

## Trust

Anyone who can use your Home Assistant can press your Tare buttons. A press logs food on your Tare account without signing in to Tare. Give Home Assistant access only to people you would trust to log your meals, and check Last meal press if an entry looks wrong.

Products found through food lookups (USDA and Open Food Facts) are cached once for the whole install. The cache does not record who looked a product up, though each product keeps the time it was retrieved. Your own foods, meals and intake stay with your account.
