## ADDED Requirements

### Requirement: Installable app shell
The engine SHALL serve a web app with a manifest, icons and a service worker so it installs to a phone's home screen. The service worker SHALL never cache an HTML response it did not build.

#### Scenario: Install on a phone
- **WHEN** a person opens the app in a supporting mobile browser
- **THEN** the browser offers to install it and the installed app opens to the sign-in or today screen

#### Scenario: Proxy login page
- **WHEN** an identity proxy in front of the app returns its own HTML login page
- **THEN** the service worker does not cache that page as the app shell

### Requirement: Offline write queue
New intake and weight entries SHALL be written to on-device storage first, each with a client-generated id, the time it was eaten and the signed-in person, and replayed to the server when possible. The app SHALL request persistent storage. An entry SHALL leave the queue only after the server acknowledges it with JSON. A network error or a 5xx response SHALL leave the entry queued for a later retry.

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
Queue requests SHALL use `redirect: "manual"`. When a replay gets a 401, a redirect or a response that is not JSON, the queue SHALL keep its entries, show that sign-in is needed, and resume after the person signs in. API requests SHALL send `X-Requested-With: XMLHttpRequest`, which an identity proxy that honors it (Cloudflare Access documents this) answers with 401 instead of a login page; the early proxy probe records the real response on the reference install.

#### Scenario: Proxy session expired
- **WHEN** queued entries are replayed after the proxy session expired
- **THEN** the entries stay queued and the app asks the person to sign in again

#### Scenario: Proxy answers with a non-JSON 403
- **WHEN** a replay gets a 403 whose body is HTML or text
- **THEN** the queue treats it as sign-in needed and keeps the entry

### Requirement: Rejected entries
When the server answers a queued entry with a JSON error other than 401, the queue SHALL mark that entry rejected with the error code, keep it visible, and continue with later entries. The person SHALL be able to edit and resend a rejected entry or discard it.

#### Scenario: Entry the server cannot accept
- **WHEN** the server answers a queued entry with a JSON 422
- **THEN** that entry shows as rejected with its reason, later entries still replay, and it stays until the person edits or discards it

### Requirement: Queue bound to its person
Queued entries SHALL be replayed only for the person who created them.

#### Scenario: Different person signs in
- **WHEN** a different person signs in on the same device while entries are queued
- **THEN** those entries are not sent as the new person
