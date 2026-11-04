ALTER TABLE inbound_emails ADD COLUMN disposition TEXT CHECK (disposition IN ('reconciled', 'questioned', 'discarded'));
ALTER TABLE inbound_emails ADD COLUMN disposition_at TEXT CHECK (disposition_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', disposition_at, '+0 seconds') IS disposition_at);
ALTER TABLE inbound_emails ADD COLUMN released_at TEXT CHECK (released_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', released_at, '+0 seconds') IS released_at);
ALTER TABLE inbound_emails ADD COLUMN manual_result TEXT;
ALTER TABLE inbound_emails ADD COLUMN applied_order_id INTEGER;
ALTER TABLE orders ADD COLUMN applied_email_id INTEGER;
