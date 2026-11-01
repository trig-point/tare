## ADDED Requirements

### Requirement: Password login with sessions
The system SHALL let a person sign in with a username and password and keep them signed in with an HTTP-only session cookie. Passwords SHALL be stored only as salted hashes.

#### Scenario: Correct password
- **WHEN** a person submits a correct username and password
- **THEN** the system sets an HTTP-only session cookie and later requests act as that person

#### Scenario: Wrong password
- **WHEN** a person submits a wrong password
- **THEN** the system rejects the sign-in with 401 and sets no cookie

### Requirement: First user from configuration
The system SHALL create the first user, as an administrator, from configuration when the database has no users.

#### Scenario: Empty database at startup
- **WHEN** the engine starts with no users and the first-user settings are present
- **THEN** that user exists with administrator rights and can sign in

### Requirement: Administrator adds a user
An administrator SHALL be able to add another person, who gets their own login, data and agent tokens.

#### Scenario: Second person added
- **WHEN** an administrator adds a user with a username and initial password
- **THEN** that person can sign in and sees none of the first person's data

### Requirement: Agent tokens
Each person SHALL be able to create named agent tokens, see when each was last used, and revoke them. Tokens SHALL be stored only as hashes and shown once at creation.

#### Scenario: Token acts for its owner
- **WHEN** an agent calls the API or MCP endpoint with a valid token
- **THEN** the call acts for the token's owner only

#### Scenario: Revoked token
- **WHEN** an agent calls with a revoked token
- **THEN** the system rejects the call with 401

### Requirement: Tenant isolation
Every personal row SHALL carry a non-null owner, owned rows SHALL reference their parents through the owner and id together, and every query on personal data SHALL take the authenticated person from the session or token, never from the request body.

#### Scenario: Another person's id
- **WHEN** a person reads, edits, deletes or totals using an id that belongs to someone else
- **THEN** the system behaves as if the row does not exist

#### Scenario: Cross-owner reference
- **WHEN** a write tries to attach a child row to a parent owned by another person
- **THEN** the database rejects it
