ALTER TABLE intake_entries ADD COLUMN slot_template_id INTEGER NULL;
ALTER TABLE intake_entries ADD COLUMN slot_position INTEGER NULL
CHECK ((slot_template_id IS NULL) = (slot_position IS NULL));

-- Slot links follow the day plan, so clearing them is not an intake edit and must not reopen a signed-off day.
DROP TRIGGER IF EXISTS intake_resets_day_on_update;
CREATE TRIGGER intake_resets_day_on_field_update
AFTER UPDATE OF id, user_id, client_id, food_id, source_food_id, servings, eaten_at, day, kcal, protein_g, carbs_g, fat_g, fiber_g, kcal_low, kcal_high, provenance, source, portion_note, created_at, updated_at, name
ON intake_entries
BEGIN
    INSERT INTO days (user_id, day, signed_off_at)
    VALUES (OLD.user_id, OLD.day, NULL)
    ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = NULL;
    INSERT INTO days (user_id, day, signed_off_at)
    VALUES (NEW.user_id, NEW.day, NULL)
    ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = NULL;
END;
