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
The system SHALL track meals on hand per person with quantity, delivery date and a revision that changes on every update. Eating one SHALL go through one meal action that takes the meal id and revision: "ate it" logs the meal's nutrition once, "ate 3/4" logs three quarters of it, and both reduce the quantity by one, in one transaction. A stale revision SHALL be rejected, and a retry with the same per-person mutation id SHALL change nothing a second time.

#### Scenario: Ate one
- **WHEN** a person marks an on-hand meal eaten
- **THEN** one intake entry is logged and the quantity drops by one, or neither happens

#### Scenario: Ate three quarters
- **WHEN** a person marks a 600 kcal on-hand meal as "ate 3/4"
- **THEN** one intake entry of 450 kcal is logged and the quantity drops by one

#### Scenario: Stale revision
- **WHEN** the action carries a revision older than the meal's current one
- **THEN** nothing is logged, the quantity is unchanged and the result says the action was stale

#### Scenario: Retried action
- **WHEN** the same action is sent twice with the same mutation id
- **THEN** intake and quantity change once and the second call returns the first result

### Requirement: Order email parsing
The parser SHALL extract service, meals, chef where stated, quantities and delivery date where stated from an order email into a fixed schema through a configured OpenAI-compatible model, with an evidence excerpt per field that must occur in the email. It SHALL have no tools and fetch nothing. Uncertain fields SHALL become questions.

#### Scenario: Unsupported field
- **WHEN** an extracted field's excerpt does not occur in the email
- **THEN** the field is dropped and a question is raised

#### Scenario: No model configured
- **WHEN** no model endpoint is configured and an order email arrives
- **THEN** the email is stored and a question asks the person to enter the order

### Requirement: Inbound order email endpoint
The engine SHALL accept raw order emails over HTTP with a per-person token, reject emails over 5 MB, read only text and HTML parts, fetch nothing the email links to, and ignore an email the same person has already sent. Tare SHALL verify the email's DKIM signature itself for the service's configured sender domain, never trusting `Authentication-Results` or other headers, and record the result. An unverified email SHALL become a question asking the person to confirm it, and its order SHALL NOT be processed until they do.

#### Scenario: Unverified sender
- **WHEN** an order email arrives without a valid DKIM signature from the service's configured domain
- **THEN** no order or meals on hand are created and the person gets a question to confirm the email

#### Scenario: Forged header
- **WHEN** an email carries an `Authentication-Results` header claiming a DKIM pass but its signature does not verify
- **THEN** it is treated as unverified

#### Scenario: Same email twice
- **WHEN** the same email is posted twice for the same person
- **THEN** it is processed once

#### Scenario: Oversized email
- **WHEN** an email over 5 MB is posted
- **THEN** the endpoint answers 413 and stores nothing

### Requirement: Order reconciliation
The system SHALL keep one order per person, service and delivery date. An email that states a delivery date SHALL join or create the order for that date. A processed or final list SHALL supersede the scheduled list. A processed email without a date SHALL attach to the person's earliest scheduled order for that service whose delivery date is after the email was received, and SHALL take each meal's chef from the scheduled list by meal name. When no order matches, the system SHALL raise a question.

#### Scenario: Scheduling then processed email
- **WHEN** a scheduling email and a processed email arrive for the same delivery
- **THEN** one order exists with the processed meals and the scheduled delivery date, and meals on hand are not doubled

#### Scenario: Processed email with no chef or date
- **WHEN** a processed email lists meals and quantities only
- **THEN** it attaches to the next scheduled delivery for that service and each meal keeps the chef the scheduling email named

#### Scenario: No scheduled order
- **WHEN** a processed email without a date arrives and the person has no later scheduled order for that service
- **THEN** no order is created and a question asks for the delivery date

### Requirement: New-meal nutrition questions
Creating an on-hand meal with no known nutrition SHALL raise a nutrition question that the person or their agent can answer with label values and a source. The answer SHALL become one of that person's own foods keyed by service, meal name and chef, so the same meal never asks that person again. A meal with no chef SHALL match on service and meal name only when exactly one of the person's foods has that name.

#### Scenario: Repeat meal
- **WHEN** a meal whose nutrition the person answered before arrives in a later order
- **THEN** no question is raised and the stored values are used
