## ADDED Requirements

### Requirement: One definition per operation
Each operation SHALL be defined once with its name, input schema, output schema, handler, caller class and whether it needs an administrator. The caller class SHALL be either session only (a signed-in person in the app) or session and agent token. Every operation SHALL be served as an HTTP route; every operation an agent token may call SHALL also be served as an MCP tool with the same schemas. In version 1 an agent token may call every session-and-agent operation for its owner; there are no finer scopes. Every administrator operation is session only. A Home Assistant button press reaches an operation through the engine's MQTT handler, which acts for the person whose device the button belongs to (see the household trust rule in the Home Assistant spec).

#### Scenario: Operation on both surfaces
- **WHEN** a session-and-agent operation is added to the registry
- **THEN** it is reachable as an HTTP route and listed as an MCP tool with the same schemas

#### Scenario: Session-only operation
- **WHEN** an agent token calls a session-only operation, such as day sign-off or token creation
- **THEN** the call is rejected with 403, and the operation is not listed as an MCP tool

#### Scenario: Surfaces cannot drift
- **WHEN** an agent-callable operation is missing from either surface, or a session-only operation appears as an MCP tool
- **THEN** the contract test fails

### Requirement: MCP server
The engine SHALL serve an MCP server over streamable HTTP at `/mcp`, authenticated by agent tokens. It SHALL reject a request whose `Origin` header is present and not on the configured allow list, and SHALL bind each MCP session to the person of the token that opened it.

#### Scenario: Agent lists tools
- **WHEN** an MCP client connects with a valid agent token
- **THEN** it can list and call every agent-callable operation for the token's owner

#### Scenario: Missing token
- **WHEN** an MCP client connects without a token
- **THEN** the server rejects the request with 401

#### Scenario: Foreign origin
- **WHEN** a request to `/mcp` carries an `Origin` that is not allowed
- **THEN** the server rejects it with 403

#### Scenario: Session used with another person's token
- **WHEN** a request carries an MCP session id opened by person A and a token belonging to person B
- **THEN** the server rejects the request

### Requirement: Provenance set by its source
Every operation that writes a nutrition value SHALL record a provenance of `verified`, `label` or `estimated`, decided by where the numbers came from. A write that references a food SHALL take that food's provenance, and a provenance argument that differs from it SHALL be rejected. A write that supplies its own numbers MAY state `label` together with a source naming where the label was read, and SHALL otherwise be stored as `estimated`. No caller SHALL be able to store `verified` for numbers it supplied; `verified` comes only from USDA Foundation and SR Legacy foods in the source cache.

#### Scenario: Agent logs free-text food
- **WHEN** an agent logs a food by name and numbers without a food reference or a provenance
- **THEN** the entry is stored with provenance `estimated`

#### Scenario: Caller claims verified
- **WHEN** a write supplies its own numbers with provenance `verified`
- **THEN** the write is rejected with a stable error code and nothing is stored

#### Scenario: Label without a source
- **WHEN** a write supplies its own numbers with provenance `label` and no source
- **THEN** the write is rejected with a stable error code

#### Scenario: Food reference
- **WHEN** a person logs a USDA Foundation food from the source cache
- **THEN** the entry carries provenance `verified` from the food

### Requirement: Errors readable by machines
Operations SHALL return JSON errors with a stable code, and SHALL return 401 rather than an HTML page when authentication is missing or expired.

#### Scenario: Expired session on an API call
- **WHEN** an API request carries an expired session
- **THEN** the response is 401 with a JSON body
