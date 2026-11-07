## ADDED Requirements

### Requirement: Installable app shell
The engine SHALL serve a web app with a manifest, icons and a service worker so it installs to a phone's home screen. The service worker SHALL never cache an HTML response it did not build.

#### Scenario: Install on a phone
- **WHEN** a person opens the app in a supporting mobile browser
- **THEN** the browser offers to install it, and the installed app opens to its home screen for a person with a valid identity, through Access in Access mode or after Tare's sign-in screen in fallback mode

#### Scenario: Proxy login page
- **WHEN** an identity proxy in front of the app returns its own HTML login page
- **THEN** the service worker does not cache that page as the app shell

### Requirement: Offline write queue
New intake and weight entries SHALL be written to on-device storage first, each with a client-generated id, the time it was eaten or measured and the signed-in person, and replayed to the server when possible. The app SHALL request persistent storage. An entry SHALL leave the queue only after the server acknowledges it with JSON. A network error, a 5xx, a 408 or a 429 response SHALL leave the entry queued for a later retry; while the app is open and online, the queue SHALL retry it on a timer that starts at 30 seconds and doubles up to a 15-minute cap, instead of waiting for a relaunch.

#### Scenario: Logged with no signal
- **WHEN** a person logs a food while offline
- **THEN** the entry appears as pending and is sent when the connection returns

#### Scenario: Lost acknowledgement
- **WHEN** the server stores an entry but the acknowledgement is lost and the entry is replayed
- **THEN** the server returns the stored entry and no duplicate is created

#### Scenario: Replayed hours later
- **WHEN** a snack eaten at 1 AM is replayed at 9 AM
- **THEN** the server assigns it to a day from its eaten-at time, not from the time it arrived

### Requirement: Sign-in-needed state
Queue requests SHALL use `redirect: "manual"`. When a replay gets a 401, a redirect (which `redirect: "manual"` returns as an `opaqueredirect` response with status 0, not as a network error) or a response that is not JSON, the queue SHALL keep its entries, show that sign-in is needed, and resume after the person signs in. API requests SHALL send `X-Requested-With: XMLHttpRequest`, which an identity proxy that honors it (Cloudflare Access documents this) answers with 401 instead of a login page; the early proxy probe records the real response on the reference install. Signing in again SHALL be a top-level navigation to a sign-in path that the service worker never answers from its cache, so in Access mode the request reaches Cloudflare Access, which shows its own sign-in page, and in fallback mode it opens Tare's sign-in screen; after signing in, the engine answers that path by sending the person back to the app, where the queue resumes.

#### Scenario: Proxy session expired
- **WHEN** queued entries are replayed after the proxy session expired
- **THEN** the entries stay queued and the app asks the person to sign in again

#### Scenario: Proxy answers with a non-JSON 403
- **WHEN** a replay gets a 403 whose body is HTML or text
- **THEN** the queue treats it as sign-in needed and keeps the entry

#### Scenario: Sign in again from the installed app
- **WHEN** the proxy session has expired and the person taps "Sign in again" in the installed app
- **THEN** Cloudflare Access's sign-in page opens in Access mode, or Tare's sign-in screen in fallback mode, and after signing in the person is back in the app and the queued entries replay

### Requirement: Rejected entries
Responses SHALL be classified in this order: network failures and deadlines retry; redirects need sign-in; any 5xx, 408 or 429 retries; a 401 or completed non-JSON body needs sign-in. A matching JSON acknowledgement SHALL remove the entry, except that an edited entry answered with `created: false` SHALL become rejected with `already_saved`, retaining its body and the stored server row. JSON 409 `person_mismatch` and 403 `not_a_member` SHALL remain pending and trigger a session reread; replay SHALL wake from that reread only if the person changes. Other JSON 4xx errors SHALL reject the entry with its code, and later entries SHALL continue. Other responses SHALL retry. Rejected entries SHALL stay visible until edited and resent or discarded; `already_saved` SHALL allow Discard only and is the sole rejection without a JSON 4xx response.

#### Scenario: Identity changed before a write
- **WHEN** a replay gets JSON 409 `person_mismatch` or 403 `not_a_member`
- **THEN** the entry stays pending, the app rereads the session, and a different confirmed person wakes replay without sending another person's entries

#### Scenario: An edited entry was already saved
- **WHEN** a replay of an edited entry gets a matching JSON acknowledgement with `created: false`
- **THEN** the queue keeps both value sets as `already_saved`, including across reload, and offers Discard only

#### Scenario: Temporary outage
- **WHEN** a replay gets a 503, with or without a JSON body
- **THEN** the entry stays queued for a later retry and is not marked rejected

#### Scenario: Rate limited or timed out
- **WHEN** a replay gets a JSON 429 or 408
- **THEN** the entry stays queued for a later retry and is not marked rejected

#### Scenario: Entry the server cannot accept
- **WHEN** the server answers a queued entry with a JSON 422
- **THEN** that entry shows as rejected with its reason, later entries still replay, and it stays until the person edits or discards it

### Requirement: Queue bound to its person
Queued entries SHALL be replayed only for the person who created them.

#### Scenario: Different person signs in
- **WHEN** a different person signs in on the same device while entries are queued
- **THEN** those entries are not sent as the new person
