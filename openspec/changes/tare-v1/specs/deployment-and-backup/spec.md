## ADDED Requirements

### Requirement: Container image
The project SHALL provide a container build (a Dockerfile and a compose example) that runs the engine and the app with a health check, a data volume and configuration from environment variables only. The environment reference SHALL state that installing the PWA, using the camera and sending `Secure` cookies need HTTPS.

#### Scenario: Clean start
- **WHEN** the image starts on an empty data volume with the documented variables
- **THEN** migrations run and `/health` returns 200

### Requirement: Scheduled jobs
The engine SHALL run its scheduled jobs (the nightly backup, the weekly recompute and the Oura sync) in-process on daily or weekly schedules in the install's configured timezone, run at most one instance of each job at a time, and record each job's last run and result.

#### Scenario: Overlapping run
- **WHEN** a job is still running when its next run is due
- **THEN** the second run is skipped and recorded as skipped

### Requirement: Nightly backup with tested restore
The engine SHALL write a nightly online SQLite backup to a configured folder outside the data volume and keep a configured number of copies. A test SHALL restore a backup and pass integrity and foreign-key checks and an authenticated read.

#### Scenario: Restore drill
- **WHEN** the restore test opens a backup produced while the app was writing
- **THEN** `PRAGMA integrity_check` and `PRAGMA foreign_key_check` pass and a signed-in read returns data

### Requirement: Migration safety
The migration runner SHALL record a checksum of each applied migration and fail when an applied file changes or goes missing. Schema changes SHALL ship as new migrations, never as edits to applied ones. Table rebuilds SHALL turn foreign keys off before the transaction begins, check them before commit, and turn them back on after.

#### Scenario: Edited migration
- **WHEN** an applied migration file is edited
- **THEN** startup fails naming that file

#### Scenario: Rebuild with a broken reference
- **WHEN** a table rebuild would leave a row pointing at a missing parent
- **THEN** the foreign-key check fails, the transaction rolls back and foreign keys are on afterwards

### Requirement: Repository hygiene check
CI SHALL fail when tracked source contains an absolute home path or a hostname or domain on the deny list. The deny list SHALL come from tracked generic patterns plus a CI variable, so personal values never enter the repository.

#### Scenario: Planted hostname
- **WHEN** a pull request adds a denied hostname to a source file
- **THEN** the CI job fails naming the file and line
