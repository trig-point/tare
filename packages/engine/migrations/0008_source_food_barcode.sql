ALTER TABLE source_foods ADD COLUMN barcode TEXT;
CREATE INDEX source_foods_barcode ON source_foods (barcode);
UPDATE source_foods SET barcode = source_key WHERE source = 'off';
