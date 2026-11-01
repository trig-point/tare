## ADDED Requirements

### Requirement: Container image
The project SHALL provide a container build (a Dockerfile and a compose example) that runs the engine and the app with a health check, a data volume and configuration from environment variables only. The environment reference SHALL state that installing the PWA, using the camera and sending `Secure` cookies need HTTPS.

#### Scenario: Clean start
- **WHEN** the image starts on an empty data volume with the documented variables
- **THEN** migrations run and `/health` returns 200

### Requirement: Scheduled jobs
The engine SHALL run its scheduled jobs (all four: the nightly backup, the daily job that records meal-kit deliveries that have come due, the weekly recompute and the Oura daily sync) in-process on daily or weekly schedules in the install's configured timezone, run at most one instance of each job at a time, and record each job's last run and result. Schedules and overrun protection SHALL come from croner, whose protect callback records a blocked run as skipped.

#### Scenario: Overlapping run
- **WHEN** a job is still running when its next run is due
- **THEN** the second run is skipped and recorded as skipped

### Requirement: Nightly backup with tested restore
The engine SHALL write a nightly online SQLite backup, through better-sqlite3's `backup()`, to a configured folder outside the data volume and keep a configured number of copies. A test SHALL restore a backup and pass integrity and foreign-key checks and an authenticated read.

#### Scenario: Restore drill
- **WHEN** the restore test opens a backup produced while the engine was writing
- **THEN** `PRAGMA integrity_check` and `PRAGMA foreign_key_check` pass and a signed-in read returns data

### Requirement: Migration safety
The migration runner SHALL record a checksum of each applied migration and fail when an applied file changes or goes missing. Schema changes SHALL ship as new migrations, never as edits to applied ones. A table rebuild SHALL be a migration whose first line is `-- tare:rebuild`, which the runner applies outside its usual transaction: it turns foreign keys off before the transaction begins, checks them before commit, and turns them back on after.

#### Scenario: Edited migration
- **WHEN** an applied migration file is edited
- **THEN** startup fails naming that file

#### Scenario: Rebuild with a broken reference
- **WHEN** a table rebuild would leave a row pointing at a missing parent
- **THEN** the foreign-key check fails, the transaction rolls back and foreign keys are on afterwards

### Requirement: Repository hygiene check
CI SHALL fail when the repository's history contains an absolute home path or a personal name, hostname or domain on the deny list. The check SHALL use gitleaks, pinned to one version by its published checksum, with custom rules kept in a CI secret so personal values never enter the repository. The rules SHALL match whole words and allow the copyright line and github.com handle URLs. CI SHALL write the secret to a file only the runner user can read and always pass it with `--config`, never through gitleaks' configuration environment variables (a parse error there prints the whole config), so a committed `.gitleaks.toml` is never read. Before the scan, a canary rule in the custom config SHALL catch a canary planted in a temporary directory, so a config that lost its rules fails. Output SHALL be redacted and reduced to summary lines with the exit code kept, because CI logs on a public repository are public. Fork pull requests and Dependabot runs cannot read the secret, so they SHALL scan with gitleaks' default rules and a warning, and the push to main re-checks with the custom rules.

#### Scenario: Planted hostname
- **WHEN** a pull request from the repository adds a denied hostname
- **THEN** the CI job fails and its log shows the leak count, never the matched value or the rules

#### Scenario: Custom rules lost
- **WHEN** the secret is missing on a push or same-repository pull request, or its config no longer catches the canary
- **THEN** the CI job fails before scanning, with a fixed message

#### Scenario: Fork pull request
- **WHEN** a pull request comes from a fork or from Dependabot
- **THEN** the job scans with gitleaks' default rules and warns that the custom rules were unavailable
