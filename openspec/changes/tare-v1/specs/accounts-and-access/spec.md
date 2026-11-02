## ADDED Requirements

### Requirement: Identity mode from configuration
The system SHALL run in exactly one identity mode, chosen by configuration at startup. Access mode is on when both the Cloudflare Access team domain and the Access application audience (AUD) tag are set; fallback mode is on when neither is set. Startup SHALL fail with an error naming the missing setting when only one of the two is set. In Access mode Cloudflare Access is the only way a browser or an agent signs in, and Tare's own password sign-in is turned off. Fallback mode keeps Tare's own password login, for installs without Cloudflare Access, and has no agent access. A fallback session cookie SHALL NOT authenticate any request in Access mode, and the Access header SHALL be ignored in fallback mode. The team domain SHALL be an `https` origin with no path or trailing slash, or startup SHALL fail naming it. Startup SHALL also fail when the database has users and none of them can sign in under the configured mode (in Access mode no user has an Access email; in fallback mode no user has a password), naming the mode the install was set up in; switching a populated install between modes is not supported in version 1.

#### Scenario: Both Access settings present
- **WHEN** the engine starts with the team domain and the AUD tag set
- **THEN** it runs in Access mode, and a verified request to the password sign-in route gets 404

#### Scenario: Neither Access setting present
- **WHEN** the engine starts with neither setting
- **THEN** it runs in fallback mode with password sign-in

#### Scenario: Only one Access setting present
- **WHEN** the engine starts with the team domain set and no AUD tag
- **THEN** startup fails with an error naming the AUD setting

#### Scenario: Populated install started in the other mode
- **WHEN** the engine starts in Access mode on a database whose users all have passwords and none has an Access email
- **THEN** startup fails with an error saying the install was set up in fallback mode

#### Scenario: Session cookie in Access mode
- **WHEN** a request in Access mode carries a valid fallback session cookie and no `Cf-Access-Jwt-Assertion` header
- **THEN** the system rejects it with 401

### Requirement: Cloudflare Access identity
In Access mode the system SHALL authenticate every request except exactly two routes, the health check and the inbound email endpoint (which carries its own token), by verifying the JWT in the `Cf-Access-Jwt-Assertion` header: RS256 signature against the team's published keys at `<team domain>/cdn-cgi/access/certs`, issuer equal to the configured team domain, audience containing the configured AUD tag, and the token's expiry. The `CF_Authorization` cookie SHALL NOT be accepted in place of the header. A verified token whose `sub` is empty and that carries a non-empty `common_name` is an agent service token (see Agent service tokens), whatever other claims it carries. Any other verified token with a non-empty `email` claim is a browser identity and SHALL act as the Tare user whose stored Access email equals that email after trimming and lowercasing. A verified token of any other shape, and a missing, invalid or expired token, SHALL get 401 with a JSON body. A verified browser identity with no matching Tare user SHALL get 403 `not_a_member` with a JSON body; Tare SHALL NOT create users on first sight. A state-changing request from a browser identity SHALL carry `X-Requested-With: XMLHttpRequest`, or the system SHALL reject it with 403, because the browser also carries Access's cookie on a cross-site request; the Oura callback, a top-level redirect, is checked by its single-use state instead.

#### Scenario: Known person through Access
- **WHEN** a request carries a valid Access token whose email belongs to a Tare user
- **THEN** the request acts as that person

#### Scenario: Header missing
- **WHEN** a request in Access mode reaches the engine without the `Cf-Access-Jwt-Assertion` header, for example directly on the local network
- **THEN** the system rejects it with 401 and a JSON body

#### Scenario: Service token that also carries an email
- **WHEN** a verified token has an empty `sub`, a `common_name` and an `email` claim
- **THEN** the system treats it as an agent service token rather than a browser identity

#### Scenario: Unrecognized token shape
- **WHEN** a verified token has neither a non-empty `email` nor an empty `sub` with a `common_name`
- **THEN** the system rejects it with 401 and a JSON body

#### Scenario: Wrong audience
- **WHEN** a request carries a validly signed token issued for another Access application
- **THEN** the system rejects it with 401

#### Scenario: Not a Tare user
- **WHEN** a request carries a valid Access token whose email belongs to no Tare user
- **THEN** the system rejects it with 403 `not_a_member` and creates no user

#### Scenario: Cross-site write through Access
- **WHEN** a request with a valid browser identity tries a write without the `X-Requested-With` header
- **THEN** the system rejects it with 403 and changes nothing

### Requirement: Fallback password login
In fallback mode the system SHALL let a person sign in with a username and password and keep them signed in with a session cookie that is HTTP-only, `SameSite=Lax`, `Secure` when the install's configured public URL is HTTPS (a proxy in front may end TLS), and valid for a configured lifetime. Passwords SHALL be stored only as scrypt hashes with a per-user salt; a user with no password (created in Access mode) cannot sign in this way. Signing out SHALL end the session on the server. Sign-in SHALL be the only public operation: it needs no session, is served only over HTTP and is never an MCP tool; signing out and the other session routes are browser only. Sign-in SHALL also require `X-Requested-With: XMLHttpRequest`, so a cross-site form cannot sign a browser into another person's account. A state-changing request authenticated by the cookie SHALL carry `X-Requested-With: XMLHttpRequest`, or the system SHALL reject it with 403; routes authenticated another way (the inbound email token, or the Oura callback's single-use state) are checked by that instead.

#### Scenario: Correct password
- **WHEN** a person submits a correct username and password in fallback mode
- **THEN** the system sets the session cookie with those attributes and later requests act as that person

#### Scenario: Wrong password
- **WHEN** a person submits a wrong password
- **THEN** the system rejects the sign-in with 401 and sets no cookie

#### Scenario: User without a password
- **WHEN** a person created in Access mode tries a password sign-in after the install switched to fallback mode
- **THEN** the system rejects it with 401, exactly as for a wrong password

#### Scenario: Sign out
- **WHEN** a person signs out and the old cookie is replayed
- **THEN** the request is rejected with 401

#### Scenario: Cross-site write
- **WHEN** a request with a valid session cookie tries a write without the `X-Requested-With` header
- **THEN** the system rejects it with 403 and changes nothing

### Requirement: First user from configuration
The system SHALL create the first user, as an administrator, from configuration when the database has no users, and SHALL refuse to start when the database has no users and those settings are missing. In Access mode the settings are a username and the administrator's Access email; in fallback mode they are a username and a password. The setup docs and `.env.example` SHALL name every identity setting: the Access team domain, the AUD tag, the administrator's username, Access email and password.

#### Scenario: Empty database at startup in Access mode
- **WHEN** the engine starts in Access mode with no users and the first-user username and Access email set
- **THEN** that user exists with administrator rights, has no password, and acts as an administrator through Access

#### Scenario: Empty database at startup in fallback mode
- **WHEN** the engine starts in fallback mode with no users and the first-user username and password set
- **THEN** that user exists with administrator rights and can sign in

#### Scenario: Empty database without settings
- **WHEN** the engine starts with no users and the first-user settings for its mode missing
- **THEN** startup fails with an error naming the missing settings

### Requirement: Administrator adds a user
An administrator SHALL be able to add another person, who gets their own data. In Access mode the administrator gives a username and the person's Access email, and the person signs in through Access. Every write path SHALL store an Access email trimmed and lowercased and reject an empty one, so uniqueness and sign-in matching ignore letter case; in fallback mode the administrator gives a username and an initial password. Adding a user, like every administrator operation, SHALL be browser only: an agent service token is never accepted for it, whoever it maps to.

#### Scenario: Second person added in Access mode
- **WHEN** an administrator adds a user with a username and Access email
- **THEN** that person's requests through Access act as them, and they see none of the first person's data

#### Scenario: Second person added in fallback mode
- **WHEN** an administrator adds a user with a username and initial password
- **THEN** that person can sign in and sees none of the first person's data

#### Scenario: Administrator's agent service token
- **WHEN** an agent service token mapped to an administrator calls the add-user operation
- **THEN** the call is rejected with 403 and no user is created

#### Scenario: Not an administrator
- **WHEN** a signed-in person who is not an administrator calls the add-user operation
- **THEN** the call is rejected with 403 and no user is created

#### Scenario: Access email already in use
- **WHEN** an administrator adds a user with an Access email another user already has, in any letter case
- **THEN** the call is rejected with 409 and no user is created

### Requirement: Agent service tokens
In Access mode an agent SHALL authenticate with a Cloudflare Access service token, and Tare SHALL decide which person it acts for from the token's Client ID (the JWT's `common_name` claim). An administrator SHALL map a Client ID to a person with a name; each person SHALL see the Client IDs mapped to them, with each one's name and last-used time, and SHALL be able to remove a mapping. Mapping and removing SHALL be browser-only operations, and mapping is an administrator operation. In fallback mode the mapping operations answer 404. A verified service token whose Client ID is not mapped SHALL get 403 `unknown_agent`. A Client ID SHALL map to at most one person. The Client ID is not a secret (the secret stays with Cloudflare and the agent), so Tare stores it as given. Fallback mode has no agent access.

#### Scenario: Service token acts for its person
- **WHEN** an agent calls the API or MCP endpoint through Access with a service token whose Client ID is mapped to person A
- **THEN** the call acts for person A only

#### Scenario: Removed mapping
- **WHEN** an agent calls with a service token whose mapping was removed
- **THEN** the system rejects the call with 403 `unknown_agent`

#### Scenario: Agent tries to map a token
- **WHEN** an agent service token calls the mapping operation
- **THEN** the system rejects the call with 403 and maps nothing

#### Scenario: Person who is not an administrator maps a token
- **WHEN** a browser identity that is not an administrator calls the mapping operation
- **THEN** the system rejects the call with 403 and maps nothing

#### Scenario: Client ID already mapped
- **WHEN** an administrator maps a Client ID that is already mapped to someone
- **THEN** the call is rejected with 409 and the existing mapping is unchanged

### Requirement: Tenant isolation
Every personal row SHALL carry a non-null owner, owned rows SHALL reference their parents through the owner and id together, and every query on personal data SHALL take the person from the authenticated identity (an Access browser identity, a mapped Access service token, or a fallback session) through the shared helper, never from the request body. Background jobs and the importer SHALL take the person from the row they process or from the command's named person, through the same helper. The only rows without a single owning person SHALL be the source cache, which every person reads and only the lookup operations write (with adapter results), and questions that no person can own (such as a reading from an unmapped scale user), which only administrators see. Every food a person or an agent creates (regular meals, typed labels, answered meal nutrition) SHALL be owned by that person. The setup docs SHALL state that the source cache is a household trust assumption: everyone on an install can find the products in it, though not who looked them up. Keys that make writes idempotent (client ids, mutation ids, inbound message hashes) SHALL be unique per person, not across the install. Every task that adds a personal table, query, operation or job SHALL add a two-user negative test with the shared helper; the tables created before the helper exists get theirs from the first tasks that read and write them.

#### Scenario: Another person's id
- **WHEN** a person reads, edits, deletes or totals using an id that belongs to someone else
- **THEN** the system behaves as if the row does not exist

#### Scenario: Cross-owner reference
- **WHEN** a write tries to attach a child row to a parent owned by another person
- **THEN** the database rejects it

#### Scenario: Saved meal stays private
- **WHEN** person A saves a regular meal and person B searches foods for its name
- **THEN** B's search does not return it

#### Scenario: Cached product is shared
- **WHEN** person A's barcode lookup caches an Open Food Facts product and person B scans the same barcode
- **THEN** B gets the cached product without an external request

#### Scenario: Same client id from two people
- **WHEN** person A and person B each submit an entry with the same client id
- **THEN** each gets their own entry and neither sees the other's
