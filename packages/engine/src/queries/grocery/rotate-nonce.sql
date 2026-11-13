UPDATE grocery_restore_nonce SET nonce = :nonce WHERE EXISTS (SELECT 1 FROM pantry_backup_marker);
