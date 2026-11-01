## ADDED Requirements

### Requirement: Password login with sessions
The system SHALL let a person sign in with a username and password and keep them signed in with a session cookie that is HTTP-only, `SameSite=Lax`, `Secure` when served over HTTPS, and valid for a configured lifetime. Passwords SHALL be stored only as scrypt hashes with a per-user salt. Signing out SHALL end the session on the server. A state-changing request authenticated by the cookie SHALL carry `X-Requested-With: XMLHttpRequest`, or the system SHALL reject it with 403.

#### Scenario: Correct password
- **WHEN** a person submits a correct username and password
- **THEN** the system sets the session cookie with those attributes and later requests act as that person

#### Scenario: Wrong password
- **WHEN** a person submits a wrong password
- **THEN** the system rejects the sign-in with 401 and sets no cookie

#### Scenario: Sign out
- **WHEN** a person signs out and the old cookie is replayed
- **THEN** the request is rejected with 401

#### Scenario: Cross-site write
- **WHEN** a request with a valid session cookie tries a write without the `X-Requested-With` header
- **THEN** the system rejects it with 403 and changes nothing

### Requirement: First user from configuration
The system SHALL create the first user, as an administrator, from configuration when the database has no users, and SHALL refuse to start when the database has no users and those settings are missing.

#### Scenario: Empty database at startup
- **WHEN** the engine starts with no users and the first-user settings are present
- **THEN** that user exists with administrator rights and can sign in

#### Scenario: Empty database without settings
- **WHEN** the engine starts with no users and no first-user settings
- **THEN** startup fails with an error naming the missing settings

### Requirement: Administrator adds a user
An administrator SHALL be able to add another person, who gets their own login, data and agent tokens.

#### Scenario: Second person added
- **WHEN** an administrator adds a user with a username and initial password
- **THEN** that person can sign in and sees none of the first person's data

### Requirement: Agent tokens
Each person SHALL be able to create named agent tokens, see when each was last used, and revoke them. Tokens SHALL be stored only as hashes and shown once at creation. Creating and revoking tokens SHALL be session-only operations.

#### Scenario: Token acts for its owner
- **WHEN** an agent calls the API or MCP endpoint with a valid token
- **THEN** the call acts for the token's owner only

#### Scenario: Revoked token
- **WHEN** an agent calls with a revoked token
- **THEN** the system rejects the call with 401

#### Scenario: Token tries to mint a token
- **WHEN** an agent token calls the token-creation operation
- **THEN** the system rejects the call with 403 and creates nothing

### Requirement: Tenant isolation
Every personal row SHALL carry a non-null owner, owned rows SHALL reference their parents through the owner and id together, and every query on personal data SHALL take the person from the session or token through the shared helper, never from the request body. Background jobs and the importer SHALL take the person from the row they process or from the command's named person, through the same helper. The only rows shared between people SHALL be the source cache that the nutrition adapters write; every food a person or an agent creates (regular meals, typed labels, answered meal nutrition) SHALL be owned by that person. Keys that make writes idempotent (client ids, mutation ids, inbound message hashes) SHALL be unique per person, not across the install. Every task that adds a personal table, query, operation or job SHALL add a two-user negative test with the shared helper.

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
