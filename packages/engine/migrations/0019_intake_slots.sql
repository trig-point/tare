ALTER TABLE intake_entries ADD COLUMN slot_template_id INTEGER NULL;
ALTER TABLE intake_entries ADD COLUMN slot_position INTEGER NULL
CHECK ((slot_template_id IS NULL) = (slot_position IS NULL));
