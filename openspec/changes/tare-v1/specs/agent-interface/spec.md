## ADDED Requirements

### Requirement: One definition per operation
Each operation SHALL be defined once with its name, input schema, output schema, handler and required scope, and SHALL be served from that definition as an HTTP route and as an MCP tool.

#### Scenario: Operation on both surfaces
- **WHEN** an operation is added to the registry
- **THEN** it is reachable as an HTTP route and listed as an MCP tool with the same schemas

#### Scenario: Surfaces cannot drift
- **WHEN** an operation exists on one surface but not the other
- **THEN** the contract test fails

### Requirement: MCP server
The engine SHALL serve an MCP server over streamable HTTP at `/mcp`, authenticated by agent tokens.

#### Scenario: Agent lists tools
- **WHEN** an MCP client connects with a valid agent token
- **THEN** it can list and call every registry operation its token's owner may use

#### Scenario: Missing token
- **WHEN** an MCP client connects without a token
- **THEN** the server rejects the request with 401

### Requirement: Explicit provenance on writes
Every operation that writes a nutrition value SHALL take a provenance of `verified`, `label` or `estimated`. A food logged without a catalog food SHALL default to `estimated`.

#### Scenario: Agent logs free-text food
- **WHEN** an agent logs a food by name and numbers without a catalog food
- **THEN** the entry is stored with provenance `estimated` unless the call says otherwise

### Requirement: Errors readable by machines
Operations SHALL return JSON errors with a stable code, and SHALL return 401 rather than an HTML page when authentication is missing or expired.

#### Scenario: Expired session on an API call
- **WHEN** an API request carries an expired session
- **THEN** the response is 401 with a JSON body
