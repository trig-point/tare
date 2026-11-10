ALTER TABLE inbound_emails ADD COLUMN origin TEXT NOT NULL DEFAULT 'email' CHECK (origin IN ('email', 'agent'));
