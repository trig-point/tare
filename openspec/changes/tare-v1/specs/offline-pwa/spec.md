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
New intake and weight entries SHALL be written to on-device storage first, each with a client-generated id and the signed-in person, and replayed to the server when possible. An entry SHALL leave the queue only after the server acknowledges it with JSON.

#### Scenario: Logged with no signal
- **WHEN** a person logs a food while offline
- **THEN** the entry appears as pending and is sent when the connection returns

#### Scenario: Lost acknowledgement
- **WHEN** the server stores an entry but the acknowledgement is lost and the entry is replayed
- **THEN** the server returns the stored entry and no duplicate is created

### Requirement: Sign-in-needed state
When a replay gets a 401, a redirect or an HTML body, the queue SHALL keep its entries, show that sign-in is needed, and resume after the person signs in. API requests SHALL send `X-Requested-With: XMLHttpRequest` so an identity proxy returns 401.

#### Scenario: Proxy session expired
- **WHEN** queued entries are replayed after the proxy session expired
- **THEN** the entries stay queued and the app asks the person to sign in again

### Requirement: Queue bound to its person
Queued entries SHALL be replayed only for the person who created them.

#### Scenario: Different person signs in
- **WHEN** a different person signs in on the same device while entries are queued
- **THEN** those entries are not sent as the new person
