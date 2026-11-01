## ADDED Requirements

### Requirement: Questions queue
The system SHALL keep a queue of questions it could not answer itself, each tied to a person and a subject, and SHALL let the person or their agent answer them through the app and over MCP.

#### Scenario: Answer a question
- **WHEN** a person answers a question
- **THEN** the answer is applied to its subject and the question closes

### Requirement: Meals on hand
The system SHALL track meals on hand per person with quantity and delivery date. Eating one SHALL log the intake and reduce the quantity in one transaction.

#### Scenario: Ate one
- **WHEN** a person marks an on-hand meal eaten
- **THEN** one intake entry is logged and the quantity drops by one, or neither happens

### Requirement: Order email parsing
The parser SHALL extract service, meals, quantities and delivery date from an order email into a fixed schema through a configured OpenAI-compatible model, with an evidence excerpt per field that must occur in the email. It SHALL have no tools and fetch nothing. Uncertain fields SHALL become questions.

#### Scenario: Unsupported field
- **WHEN** an extracted field's excerpt does not occur in the email
- **THEN** the field is dropped and a question is raised

#### Scenario: No model configured
- **WHEN** no model endpoint is configured and an order email arrives
- **THEN** the email is stored and a question asks the person to enter the order

### Requirement: Inbound order email endpoint
The engine SHALL accept raw order emails over HTTP with a per-person token, enforce size and MIME limits, record whether the sender was verified, and ignore an email it has already received.

#### Scenario: Same email twice
- **WHEN** the same email is posted twice
- **THEN** it is processed once

### Requirement: Order reconciliation
The system SHALL merge emails about one order into one order per service and delivery week. A processed or final list SHALL supersede a scheduled list, and the delivery date SHALL come from whichever email states it, or from a question.

#### Scenario: Scheduling then processed email
- **WHEN** a scheduling email and a processed email arrive for the same week
- **THEN** one order exists with the processed meals and the scheduled delivery date, and meals on hand are not doubled

### Requirement: New-meal nutrition questions
A meal with no known nutrition SHALL raise a nutrition question that a person or an agent can answer with label values and a source. The answer SHALL enter the catalog keyed by service, meal name and chef so the same meal never asks again.

#### Scenario: Repeat meal
- **WHEN** a meal whose nutrition was answered before arrives in a later order
- **THEN** no question is raised and the catalog values are used
