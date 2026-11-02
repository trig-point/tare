## ADDED Requirements

### Requirement: One definition per operation
Each operation SHALL be defined once with its name, input schema, output schema, handler, caller class and whether it needs an administrator. The caller class SHALL be public, browser only (a person in the app: an Access browser identity, or a session in fallback mode) or browser and agent (adds an Access agent service token). Public SHALL be used for fallback sign-in only: it needs no identity, is served only as an HTTP route and is never an MCP tool. Every operation SHALL be served as an HTTP route; every operation an agent may call SHALL also be served as an MCP tool with the same schemas. In version 1 an agent service token may call every browser-and-agent operation for its person; there are no finer scopes. Every administrator operation is browser only.

#### Scenario: Operation on both surfaces
- **WHEN** a session-and-agent operation is added to the registry
- **THEN** it is reachable as an HTTP route and listed as an MCP tool with the same schemas

#### Scenario: Browser-only operation
- **WHEN** an agent service token calls a browser-only operation, such as mapping a service token
- **THEN** the call is rejected with 403, and the operation is not listed as an MCP tool

#### Scenario: Signed-out sign-in
- **WHEN** a signed-out person in fallback mode, with no session cookie, submits a correct username and password to the sign-in route
- **THEN** they are signed in, and the sign-in operation is not listed as an MCP tool

#### Scenario: Surfaces cannot drift
- **WHEN** an agent-callable operation is missing from either surface, or a browser-only operation appears as an MCP tool
- **THEN** the contract test fails

### Requirement: MCP server
The engine SHALL serve an MCP server over streamable HTTP at `/mcp`, built on the MCP TypeScript SDK and authenticated by Access agent service tokens. In fallback mode `/mcp` answers 404, because fallback mode has no agent access. A Tare middleware in front of the SDK transport SHALL reject a request whose `Origin` header is present and not on the configured allow list, and SHALL pass a request with no `Origin` header, which is what agent clients send. The SDK transport's own Origin check SHALL stay off, because it also rejects a request with no `Origin`. The engine SHALL bind each MCP session to the person of the service token that opened it.

#### Scenario: Agent lists tools
- **WHEN** an MCP client connects through Access with a mapped service token
- **THEN** it can list and call every agent-callable operation for the token's person

#### Scenario: Missing token
- **WHEN** an MCP client reaches `/mcp` without a valid Access token
- **THEN** the server rejects the request with 401

#### Scenario: Browser identity on MCP
- **WHEN** a request to `/mcp` carries a valid Access browser identity and no service token
- **THEN** the server rejects it with 403, because MCP is for agents

#### Scenario: Foreign origin
- **WHEN** a request to `/mcp` carries an `Origin` that is not allowed
- **THEN** the server rejects it with 403 before the SDK transport sees it

#### Scenario: No Origin header
- **WHEN** an agent client sends a request to `/mcp` with a valid service token and no `Origin` header
- **THEN** the request reaches the MCP server

#### Scenario: Allowed origin
- **WHEN** a request to `/mcp` carries an `Origin` on the allow list and a valid service token
- **THEN** the request reaches the MCP server

#### Scenario: MCP session used with another person's token
- **WHEN** a request carries an MCP session id opened by person A and a service token mapped to person B
- **THEN** the server rejects the request

### Requirement: Provenance set by its source
Every operation that writes a nutrition value SHALL record a provenance of `verified`, `label` or `estimated`, decided by where the numbers came from. A write that references a food SHALL take that food's provenance, and a provenance argument that differs from it SHALL be rejected. A write that supplies its own numbers MAY state `label` together with a source naming where the label was read; a `label` claim without a source SHALL be rejected, and a write that makes no provenance claim SHALL be stored as `estimated`. No caller SHALL be able to store `verified` for numbers it supplied; `verified` comes only from USDA Foundation and SR Legacy foods in the source cache.

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

#### Scenario: Expired identity on an API call
- **WHEN** an API request carries an expired Access token, or an expired session in fallback mode
- **THEN** the response is 401 with a JSON body
