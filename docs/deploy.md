# Deploy Tare

Install Docker Engine with Docker Compose. Run these commands from the repository root.
The image builds the web app and runs the engine on Node 22 as the unprivileged `node` user.
It compiles better-sqlite3 for the image's Linux base and reads configuration from environment variables only.

## Start with Compose

Create a private `.env` file with your first administrator settings:

```sh
touch .env
chmod 600 .env
```

Fill in these placeholders in `.env` before starting. Choose a new password; do not use the placeholder.

```dotenv
TARE_ADMIN_USERNAME=replace-with-a-username
TARE_ADMIN_PASSWORD=replace-with-a-long-random-password
TARE_TIMEZONE=UTC
TARE_PUBLIC_URL=
```

```sh
docker compose -f compose.example.yaml up --build --detach --wait
curl --fail http://127.0.0.1:3000/health
```

The engine applies migrations on first start and serves the app at `http://127.0.0.1:3000/`.
The health check expects `/health` to return 200. Compose inherits the check from the image.
On an empty database, startup requires the administrator variables for the selected login mode.
After the first start, remove the first administrator settings from `.env`; the account remains in the database.
Keep `.env` private and out of version control. It is excluded from the image build context.

The example publishes port 3000 on the host's loopback interface for a local reverse proxy.
If the proxy runs elsewhere, adjust the port binding or attach it to the Compose network.
The image listens on port 3000 by default. Compose sets `PORT` in `compose.example.yaml` instead of `.env`.
To change it, update both `PORT` and the port mapping there.

To stop and recreate the service while keeping both volumes:

```sh
docker compose -f compose.example.yaml down
docker compose -f compose.example.yaml up --detach --wait
```

## Build and run without Compose

Use the same private `.env` file. `docker run --env-file` reads values literally, so do not wrap them in quotes.
Leave `DATABASE_URL` and `TARE_BACKUP_DIR` out of this file so the image defaults keep the database and backups
on their volumes. A local development `.env` copied from `.env.example` sets `DATABASE_URL` to a path outside `/data`.

```sh
docker build --tag tare:local .
docker run --detach --name tare --env-file .env \
  --publish 127.0.0.1:3000:3000 \
  --volume tare-data:/data --volume tare-backups:/backups tare:local
curl --fail http://127.0.0.1:3000/health
```

The container may still be starting when the first request runs; its health status records readiness.
Recreating it with the same named volumes preserves the database and backups.

## HTTPS and login mode

Installing the PWA, using the camera and sending `Secure` cookies need HTTPS.
Terminate TLS in a reverse proxy in front of Tare and set `TARE_PUBLIC_URL` to the external HTTPS URL,
for example `https://tare.example.com`. The engine itself serves HTTP.
An HTTPS public URL enables the `Secure` flag on session cookies.

Choose the login mode before the first start. Switching a populated install between modes is unsupported.

- Fallback mode: leave `TARE_ACCESS_TEAM_DOMAIN` and `TARE_ACCESS_AUD` unset. Set `TARE_ADMIN_USERNAME`
  and `TARE_ADMIN_PASSWORD` for the first start. People sign in with a Tare username and password.
- Cloudflare Access mode: set both Access settings, `TARE_ADMIN_USERNAME` and `TARE_ADMIN_ACCESS_EMAIL`.
  Leave `TARE_ADMIN_PASSWORD` unset. Put Tare behind the Access application and forward its signed
  `Cf-Access-Jwt-Assertion` header. Tare verifies the token and requires a matching account; it does not
  sign up unknown emails. Agent service tokens must be mapped to a person by an administrator.
  MCP is available only in Access mode.

## Environment reference

Defaults below describe the engine unless an image default is shown. Compose uses the image's data,
backup and port settings and passes the other settings from the shell or `.env`.
Relative filesystem paths resolve from `/app/packages/engine` in the image.

| Variable | Default | Meaning and validation |
| --- | --- | --- |
| `DATABASE_URL` | Required; image: `/data/tare.sqlite` | Trimmed SQLite path, or `:memory:` for ephemeral use. Parent directories are created. Use `/data` for persistence. |
| `PORT` | `3000` | Integer from 1 to 65535. An empty value is invalid. |
| `TARE_TIMEZONE` | `UTC` | IANA timezone for scheduled jobs and the first administrator. Empty or invalid values prevent startup. |
| `TARE_TARGET_WEEKDAY` | `monday` | Weekly target recompute day at 3:00 AM in `TARE_TIMEZONE`. English weekday names, trimmed and case-insensitive; empty uses the default. Invalid values prevent startup. |
| `TARE_TDEE_WINDOW_DAYS` | `28` | Adaptive TDEE window in days, integer from 14 to 90. Trimmed; empty uses the default. |
| `TARE_TDEE_ENERGY_DENSITY` | `7700` | Energy per kilogram of body weight change in kcal, from 5000 to 10000. Trimmed; empty uses the default. |
| `TARE_TDEE_MIN_SIGNED_DAYS` | `14` | Signed-off days needed for an adaptive estimate, integer from 1 to the window length. Trimmed; empty uses the default. |
| `TARE_TDEE_MIN_WEIGH_IN_DAYS` | `8` | Days with a weigh-in needed for an adaptive estimate, integer from 1 to the window length. Trimmed; empty uses the default. |
| `TARE_TDEE_MIN_SPAN_DAYS` | `14` | Elapsed days of weight trend needed for an adaptive estimate, integer from 1 to the window length. Trimmed; empty uses the default. |
| `TARE_TDEE_DEFAULT_RANGE` | `0.25` | Range applied to estimated intake without stored low and high values, from 0 to 0.9. Trimmed; empty uses the default. |
| `TARE_WHY_BASELINE_DAYS` | `28` | Days before the day that form a why-line baseline, integer from 14 to 90. Trimmed; empty uses the default. |
| `TARE_WHY_MIN_BASELINE_DAYS` | `14` | Days of a signal needed before it gets why-lines, integer from 2 to the baseline length. Trimmed; empty uses the default. |
| `TARE_WHY_DEVIATIONS` | `1` | Standard deviations from the baseline mean before a why-line shows, from 0.1 to 5. Trimmed; empty uses the default. |
| `TARE_WHY_HRV_PERCENT` | `10` | HRV change from the baseline mean also needed, in percent, from 0 to 100. Trimmed; empty uses the default. |
| `TARE_WHY_LATE_HOURS` | `4` | A workout ending this many hours before sleep counts as late, integer from 1 to 12. Trimmed; empty uses the default. |
| `TARE_WHY_LATE_MINUTES` | `30` | Shortest workout that counts as late, in minutes, integer from 1 to 240. Trimmed; empty uses the default. |
| `TARE_ORDER_MODEL_BASE_URL` | Unset (order parsing disabled) | HTTP or HTTPS base URL of an OpenAI-compatible model. May include a path, but not credentials, a query or a fragment. Trimmed; empty counts as unset. Set all three order model settings or none. |
| `TARE_ORDER_MODEL` | Unset (order parsing disabled) | Model name sent to the endpoint. Trimmed; empty counts as unset. Set all three order model settings or none. |
| `TARE_ORDER_MODEL_API_KEY` | Unset (order parsing disabled) | API key for the endpoint. This is a secret: supply it through the environment, never in a file you commit. A keyless local endpoint needs a placeholder. Trimmed; empty counts as unset. Set all three order model settings or none. |
| `TARE_ORDER_EMAIL_SERVICES` | Unset (all email held as unverified) | JSON map, for example `{"kit-a":{"senders":["orders@kit-a.example.com"],"dkim_domains":["kit-a.example.com"]}}`. Each service needs a sender or domain. Addresses and domains are lowercased. Duplicate senders and cross-service parent/subdomain overlap prevent startup. Accepted DKIM domains must be controlled by the service, never shared mail provider domains. |
| `TARE_PUBLIC_URL` | Unset | HTTP or HTTPS URL. Empty counts as unset. Set the external HTTPS URL to enable `Secure` session cookies. |
| `TARE_SESSION_DAYS` | `30` | Absolute session lifetime, integer from 1 to 365. Trimmed; empty uses the default. |
| `TARE_BACKUP_DIR` | Unset (disabled); image: `/backups` | Trimmed backup folder, outside the database folder and its descendants. Empty disables backups. `/data/backups` is invalid for the default database. |
| `TARE_BACKUP_KEEP` | `7` | Number of backup copies to retain, integer from 1 to 365. Trimmed; empty uses the default. |
| `TARE_ADMIN_USERNAME` | Unset | First administrator's username, required on an empty database in either mode. Trimmed, 1 to 64 characters. |
| `TARE_ADMIN_PASSWORD` | Unset | First administrator's password, required on an empty fallback database. Preserved exactly, 1 to 1024 characters; empty counts as unset. |
| `TARE_ADMIN_ACCESS_EMAIL` | Unset | First administrator's Access email, required on an empty Access database. Trimmed and lowercased. |
| `TARE_ACCESS_TEAM_DOMAIN` | Unset | Access HTTPS origin, with no path or trailing slash. Requires `TARE_ACCESS_AUD`; both unset select fallback mode. |
| `TARE_ACCESS_AUD` | Unset | Access application's audience tag. Trimmed; must be set with the team domain. |
| `TARE_MCP_ALLOWED_ORIGINS` | Empty list | Comma-separated HTTP or HTTPS origins without paths. Entries are trimmed. Empty permits only MCP requests without an `Origin` header. Invalid entries prevent startup. |
| `TARE_OURA_CLIENT_ID` | Unset (Oura disabled) | Oura application client ID. Trimmed; empty counts as unset. Set all three Oura application settings or none. See [Connect Oura](oura.md). |
| `TARE_OURA_CLIENT_SECRET` | Unset (Oura disabled) | Oura application client secret. This is a secret: supply it through the environment. Trimmed; empty counts as unset. Set all three Oura application settings or none. |
| `TARE_OURA_REDIRECT_URL` | Unset (Oura disabled) | Exact callback URL registered with Oura: absolute HTTP or HTTPS, no fragment. Trimmed; empty counts as unset. Set all three Oura application settings or none. |
| `TARE_OURA_TOKEN_KEY` | Unset (no new Oura connections) | Canonical base64 for 32 bytes that encrypts stored Oura tokens. Malformed values prevent startup. Back it up separately from database copies; restoring without it requires reconnecting. |
| `TARE_ACTIVITY_CREDIT` | `same-day` | When Oura activity counts toward the day's target: `same-day` syncs Oura every hour, and `next-day` syncs once a day at 7:00 AM in `TARE_TIMEZONE`. Trimmed and case-insensitive; empty uses the default. Other values prevent startup. |
| `TARE_ACTIVITY_BONUS_CAP` | `500` | Largest daily activity bonus in kcal, an integer from 1 to 2000. Trimmed; empty uses the default. Other values prevent startup. |
| `TARE_MQTT_URL` | Unset (Home Assistant publisher disabled) | `mqtt` or `mqtts` broker URL with no credentials or path. Trimmed; empty counts as unset. Invalid values prevent startup; a broker that is down does not. |
| `TARE_MQTT_USERNAME` | Unset | Broker username. Trimmed; empty counts as unset. Set it with `TARE_MQTT_PASSWORD` or leave both unset. |
| `TARE_MQTT_PASSWORD` | Unset | Broker password. This is a secret: supply it through the environment, never in a file you commit. Trimmed; empty counts as unset. Set it with `TARE_MQTT_USERNAME` or leave both unset. |
| `TARE_HA_DISCOVERY_PREFIX` | `homeassistant` | Home Assistant discovery prefix, an MQTT topic without wildcards or empty levels. Trimmed; empty uses the default. |
| `TARE_HA_STATUS_TOPIC` | `homeassistant/status` | Topic where Home Assistant publishes `online` on start, set apart from the discovery prefix. Same topic rules; empty uses the default. |
| `TARE_SCALE_USERS` | Unset (scale weigh-ins disabled) | JSON map from scale user to Tare username, for example `{"alex":"alex"}`. Requires `TARE_MQTT_URL`. Keys are single topic levels other than `status`; usernames must exist and be distinct. Empty or `{}` counts as unset; invalid values prevent startup. |
| `TARE_SCALE_TOPIC` | `scale/body-composition` | Base topic of the scale's readings; Tare reads `<topic>/<scale user>`. Same topic rules as the discovery prefix; used only when `TARE_SCALE_USERS` is set. |
| `TARE_USDA_API_KEY` | Unset (USDA disabled) | USDA FoodData Central API key. Trimmed; empty disables USDA requests. |
| `TARE_OFF_USER_AGENT` | Unset (Open Food Facts disabled) | Must follow `AppName/Version (ContactEmail)`, for example `Tare/1.0 (support@example.com)`. Trimmed; empty disables requests. |

The administrator settings are read only while the database has no users.
Store credentials in the private environment file or process environment, never in the image.

## Backup storage

The image enables daily online SQLite backups at 3:00 AM in `TARE_TIMEZONE`.
Copies appear in `/backups` as `tare-<compact UTC timestamp>.sqlite`; retention leaves other files alone.
Compose mounts `tare-data` at `/data` and a different named volume, `tare-backups`, at `/backups`.
Compose prefixes their names with the project name, so keep that name stable when recreating the service.

`docker compose down` keeps these volumes. `docker compose down --volumes` deletes both the database
and backups. Separate volumes survive container recreation, but do not protect against losing the host;
copy backups to separate storage.
