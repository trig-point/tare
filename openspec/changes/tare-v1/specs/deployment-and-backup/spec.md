## ADDED Requirements

### Requirement: Container image
The project SHALL publish a container build that runs the engine and app with a health check, a data volume and configuration from environment variables only.

#### Scenario: Clean start
- **WHEN** the image starts on an empty data volume with the documented variables
- **THEN** migrations run and `/health` returns 200

### Requirement: Nightly backup with tested restore
The engine SHALL write a nightly online SQLite backup to a configured folder outside the data volume and keep a configured number of copies. A test SHALL restore a backup and pass integrity and foreign-key checks and an authenticated read.

#### Scenario: Restore drill
- **WHEN** the restore test opens a backup produced while the app was writing
- **THEN** `PRAGMA integrity_check` and `PRAGMA foreign_key_check` pass and a signed-in read returns data

### Requirement: Migration safety
The migration runner SHALL record a checksum of each applied migration and fail when an applied file changes or goes missing. Table rebuilds SHALL turn foreign keys off before the transaction begins and check them before commit.

#### Scenario: Edited migration
- **WHEN** an applied migration file is edited
- **THEN** startup fails naming that file

### Requirement: Repository hygiene check
CI SHALL fail when tracked source contains an absolute home path or a hostname or domain on the deny list. The deny list SHALL come from tracked generic patterns plus a CI variable, so personal values never enter the repository.

#### Scenario: Planted hostname
- **WHEN** a pull request adds a denied hostname to a source file
- **THEN** the CI job fails naming the file and line
