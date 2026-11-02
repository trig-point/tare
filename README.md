# tare
Tare — open-source closed-loop nutrition + body-composition tracker. Mobile-first, self-hosted, Home Assistant. Learns your TDEE from weigh-ins + intake, plans meals from your pantry.

## Backup and restore

Set `TARE_BACKUP_DIR` to a folder on separate storage from the database volume. Backups run daily at 3:00 AM in `TARE_TIMEZONE`. Empty or unset disables backups. Relative paths resolve from the engine process working directory (`packages/engine` when using the workspace command). Startup rejects a backup folder that is the database folder or inside it; it does not check whether the folders are on separate storage.

`TARE_BACKUP_KEEP` defaults to `7` and accepts integers from 1 to 365. Empty counts as unset. Both settings trim surrounding whitespace. Each completed copy is named `tare-<compact UTC timestamp>.sqlite` in the backup folder. Retention deletes the oldest matching copies beyond the configured count and leaves other files alone. Failed or incomplete copies are never counted.

To restore:

1. Stop the engine.
2. Copy a completed backup over the file named by `DATABASE_URL`. If SQLite `-wal` or `-shm` files remain beside the database after shutdown, remove those sidecar files before replacing it.
3. Start the engine with the same configuration. Verify `GET /health`, then sign in and inspect your data.
