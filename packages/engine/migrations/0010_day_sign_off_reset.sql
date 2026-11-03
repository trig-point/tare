CREATE TRIGGER intake_resets_day_on_insert AFTER INSERT ON intake_entries
BEGIN
    INSERT INTO days (user_id, day, signed_off_at)
    VALUES (NEW.user_id, NEW.day, NULL)
    ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = NULL;
END;

CREATE TRIGGER intake_resets_day_on_update AFTER UPDATE ON intake_entries
BEGIN
    INSERT INTO days (user_id, day, signed_off_at)
    VALUES (OLD.user_id, OLD.day, NULL)
    ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = NULL;
    INSERT INTO days (user_id, day, signed_off_at)
    VALUES (NEW.user_id, NEW.day, NULL)
    ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = NULL;
END;

CREATE TRIGGER intake_resets_day_on_delete AFTER DELETE ON intake_entries
BEGIN
    INSERT INTO days (user_id, day, signed_off_at)
    VALUES (OLD.user_id, OLD.day, NULL)
    ON CONFLICT (user_id, day) DO UPDATE SET signed_off_at = NULL;
END;

INSERT INTO days (user_id, day)
SELECT DISTINCT user_id, day FROM intake_entries WHERE true
ON CONFLICT (user_id, day) DO NOTHING;
