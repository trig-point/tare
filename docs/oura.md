# Connect Oura

Register an OAuth application in the [Oura developer portal](https://cloud.ouraring.com/oauth/applications). Each Tare install uses its own application. Oura allows ten users before application review.

Register the install's exact callback URL, for example `https://tare.example.test/api/oura/callback`. Set `TARE_OURA_REDIRECT_URL` to that identical string. Tare sends it unchanged during authorization and token exchange. It must be an absolute HTTP or HTTPS URL without a fragment.

Set `TARE_OURA_CLIENT_ID`, `TARE_OURA_CLIENT_SECRET` and `TARE_OURA_REDIRECT_URL` together. Empty or whitespace values count as unset. Leaving all three unset disables new connections.

Generate an independent token key with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'` and supply it as `TARE_OURA_TOKEN_KEY`. Keep it outside SQLite and back it up separately from database copies. A malformed supplied key prevents startup. A missing key allows startup but prevents new connections.

GET `/api/oura` requires a browser identity and returns `configured` (true only when the application settings and the token key are both set), stored status, credential readability, the derived `reconnect_required` flag, scopes and their source, access expiry and last-sync time. It never returns tokens. An omitted scope in the initial token response means the requested `daily workout` scopes were granted. During refresh, an omitted scope keeps the stored scopes and their source; an explicit scope replaces them with source `response`, and an empty string stores no scopes. Oura may send scope as a list of strings or as null: a list counts as an explicit scope, and null counts as an omitted scope.

POST `/api/oura/connect` requires a browser identity and returns the Oura authorization URL. Each call replaces that person's unfinished attempt, which expires after ten minutes. Oura returns the browser to GET `/api/oura/callback`, which accepts only the person who started the attempt and redirects to `/?oura=connected` or `/?oura=failed`. A failed attempt keeps any existing connection; start again to retry.

Restoring without the original key preserves the encrypted connection and all other data. Credentials read as `unreadable`, with `reconnect_required: true`; stored membership status stays visible. Restoring the original key makes the saved credentials readable again. Reconnecting replaces the pair and advances its generation without resetting last-sync time.

Run one engine process per database. Token refresh and health sync are separate work; this connection flow does neither. Last-sync time remains empty until a sync stores health signals.

Keep Cloudflare Access protection on the registered callback. Do not log its query strings at a reverse proxy: they contain OAuth codes and state. A full browser return through Cloudflare Access with a real Oura app still needs deployment verification.
