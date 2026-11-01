## ADDED Requirements

### Requirement: Questions queue
The system SHALL keep a queue of questions it could not answer itself, each tied to a subject and to a person, or to the administrators when no person can be determined (such as a reading from an unmapped scale user). The owner or their agent SHALL be able to answer through the app and over MCP.

#### Scenario: Answer a question
- **WHEN** a person answers a question
- **THEN** the answer is applied to its subject and the question closes

#### Scenario: Question with no person
- **WHEN** a question is raised that belongs to no person
- **THEN** every administrator sees it and no other person does

### Requirement: Meals on hand
An order's meals SHALL be expected meals until its delivery date arrives in the person's day, checked by a daily job, or until a person or their agent calls `mark_delivery` for that order, whichever comes first; then they become meals on hand. Expected meals have no eat actions and no Home Assistant buttons. The system SHALL track meals on hand per person with quantity, delivery date and a revision that changes on every update. Eating one SHALL go through one meal action that takes the meal id, its revision and a per-person mutation id. The action SHALL first look up the mutation id and, when it was already applied, return the stored result without checking the revision; otherwise it SHALL reject a stale revision. "Ate it" logs the meal's nutrition once and "ate 3/4" logs three quarters of it, and both reduce the quantity by one, in one transaction. A meal whose nutrition question is unanswered, or whose quantity is zero, SHALL be rejected with a stable error code and nothing changed.

#### Scenario: Delivery date arrives
- **WHEN** the person's day reaches an order's delivery date and nobody has called `mark_delivery`
- **THEN** its expected meals become meals on hand

#### Scenario: Ate one
- **WHEN** a person marks an on-hand meal eaten
- **THEN** one intake entry is logged and the quantity drops by one, or neither happens

#### Scenario: Ate three quarters
- **WHEN** a person marks a 600 kcal on-hand meal as "ate 3/4"
- **THEN** one intake entry of 450 kcal is logged and the quantity drops by one

#### Scenario: Stale revision
- **WHEN** an action with a new mutation id carries a revision older than the meal's current one
- **THEN** nothing is logged, the quantity is unchanged and the result says the action was stale

#### Scenario: Retried action
- **WHEN** an action that succeeded is sent again with the same mutation id and its original revision
- **THEN** intake and quantity change once and the second call returns the first result

#### Scenario: Nutrition not answered yet
- **WHEN** a person eats an on-hand meal whose nutrition question is still open
- **THEN** the action is rejected with a stable error code and the quantity is unchanged

#### Scenario: None left
- **WHEN** a person eats an on-hand meal whose quantity is zero
- **THEN** the action is rejected with a stable error code and nothing is logged

### Requirement: Order email parsing
The parser SHALL extract service, meals, chef where stated, quantities and delivery date where stated from an order email into a fixed schema through a configured OpenAI-compatible model, with an evidence excerpt per field that must occur in the email. It SHALL have no tools and fetch nothing. Uncertain fields SHALL become questions.

#### Scenario: Unsupported field
- **WHEN** an extracted field's excerpt does not occur in the email
- **THEN** the field is dropped and a question is raised

#### Scenario: No model configured
- **WHEN** no model endpoint is configured and an order email arrives
- **THEN** the email is stored and a question asks the person to enter the order

### Requirement: Inbound order email endpoint
The engine SHALL accept raw order emails over HTTP authenticated by a per-person inbound token, which is stored hashed, created and rotated through session-only operations, and allows nothing but posting emails. It SHALL reject emails over 5 MB, read only text and HTML parts, fetch nothing the email links to, and ignore an email the same person has already sent. Each service's sender domain and sender address SHALL come from install configuration. Each email SHALL be marked:

- verified, when Tare checks a DKIM signature itself and it passes for the service's configured sender domain, either on the posted message or on the original attached as `message/rfc822`; Tare never trusts `Authentication-Results` or other headers for this;
- sender-matched, when no signature verifies but the original sender is the service's configured sender address; the authenticated endpoint is then the trust boundary;
- unverified, otherwise.

Verified and sender-matched emails SHALL be parsed. An unverified email SHALL be held as a question asking the person to confirm it. The operator's mail rule SHALL post the raw original message, or forward it with the original attached; an inline forward rewrites the message, so its signature cannot verify and it can at best be sender-matched.

#### Scenario: Missing or wrong token
- **WHEN** an email is posted without a valid inbound token
- **THEN** the endpoint answers 401 and stores nothing

#### Scenario: Original attached
- **WHEN** a forward carries the original as `message/rfc822` and the original's DKIM signature passes for the configured domain
- **THEN** the email is marked verified and parsed

#### Scenario: Inline forward from the right sender
- **WHEN** an inline forward's original sender is the service's configured address and no signature verifies
- **THEN** the email is marked sender-matched and parsed

#### Scenario: Unverified sender
- **WHEN** an email neither verifies nor matches the configured sender
- **THEN** no order or meals are created and the person gets a question to confirm the email

#### Scenario: Forged header
- **WHEN** an email carries an `Authentication-Results` header claiming a DKIM pass but no signature verifies and the sender does not match
- **THEN** it is treated as unverified

#### Scenario: Same email twice
- **WHEN** the same email is posted twice for the same person
- **THEN** it is processed once

#### Scenario: Oversized email
- **WHEN** an email over 5 MB is posted
- **THEN** the endpoint answers 413 and stores nothing

### Requirement: Order reconciliation
The system SHALL keep one order per person, service and delivery date. An email that states a delivery date SHALL join or create the order for that date. A processed or final list SHALL supersede the expected meals of an order that has not been delivered yet. A processed email without a date SHALL attach to the person's earliest scheduled order for that service whose delivery date is after the email was received, and SHALL take each meal's chef from the scheduled list by meal name. When no order matches, or a list arrives for an order already delivered, the system SHALL raise a question instead of changing stock. Confirming a held email SHALL release it into parsing and reconciliation; rejecting it SHALL discard it.

#### Scenario: Scheduling then processed email
- **WHEN** a scheduling email and a processed email arrive for the same delivery
- **THEN** one order exists with the processed meals and the scheduled delivery date, and meals on hand are not doubled

#### Scenario: Processed email with no chef or date
- **WHEN** a processed email lists meals and quantities only
- **THEN** it attaches to the next scheduled delivery for that service and each meal keeps the chef the scheduling email named

#### Scenario: No scheduled order
- **WHEN** a processed email without a date arrives and the person has no later scheduled order for that service
- **THEN** no order is created and a question asks for the delivery date

#### Scenario: Confirmed held email
- **WHEN** the person confirms a held unverified email
- **THEN** it is parsed and reconciled as if it had been verified

### Requirement: New-meal nutrition questions
When an order is created with a meal that has no known nutrition, the system SHALL raise a nutrition question that the person or their agent can answer with label values and a source, before the meal arrives. The answer SHALL become one of that person's own foods keyed by service, meal name and chef, so the same meal never asks that person again. A meal with no chef SHALL match on service and meal name only when exactly one of the person's foods has that name.

#### Scenario: Repeat meal
- **WHEN** a meal whose nutrition the person answered before arrives in a later order
- **THEN** no question is raised and the stored values are used
