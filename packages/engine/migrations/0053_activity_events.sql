-- AUTOINCREMENT: record rowids are reused after a delete, so they cannot mark which events were already sent.
-- Rows point at records instead of copying them, so deleting a record leaves none of its values behind.
CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users (id),
  kind TEXT NOT NULL CHECK (kind IN ('food', 'dose', 'weight', 'workout')),
  record_id INTEGER NOT NULL,
  dose_status TEXT CHECK (
    (kind = 'dose' AND dose_status IN ('taken', 'skipped')) OR (kind != 'dose' AND dose_status IS NULL)
  )
) STRICT;
CREATE INDEX activity_events_record ON activity_events (kind, record_id);

CREATE TRIGGER activity_event_food AFTER INSERT ON intake_entries
BEGIN
  INSERT INTO activity_events (user_id, kind, record_id) VALUES (NEW.user_id, 'food', NEW.id);
END;
CREATE TRIGGER activity_event_food_deleted AFTER DELETE ON intake_entries
BEGIN
  DELETE FROM activity_events WHERE kind = 'food' AND record_id = OLD.id;
END;

CREATE TRIGGER activity_event_weight AFTER INSERT ON weights
BEGIN
  INSERT INTO activity_events (user_id, kind, record_id) VALUES (NEW.user_id, 'weight', NEW.id);
END;
CREATE TRIGGER activity_event_weight_deleted AFTER DELETE ON weights
BEGIN
  DELETE FROM activity_events WHERE kind = 'weight' AND record_id = OLD.id;
END;

CREATE TRIGGER activity_event_workout AFTER INSERT ON activity_sessions
BEGIN
  INSERT INTO activity_events (user_id, kind, record_id) VALUES (NEW.user_id, 'workout', NEW.id);
END;
CREATE TRIGGER activity_event_workout_deleted AFTER DELETE ON activity_sessions
BEGIN
  DELETE FROM activity_events WHERE kind = 'workout' AND record_id = OLD.id;
END;

-- Medications belong to the install, not a user, so a NULL user_id reaches every person. Undo returns to scheduled and fires nothing; stopped skips are not logged by anyone.
CREATE TRIGGER activity_event_dose AFTER UPDATE OF status ON medication_doses
WHEN NEW.status != OLD.status AND (NEW.status = 'taken' OR NEW.skip_reason = 'user')
BEGIN
  INSERT INTO activity_events (user_id, kind, record_id, dose_status) VALUES (NULL, 'dose', NEW.id, NEW.status);
END;
CREATE TRIGGER activity_event_dose_deleted AFTER DELETE ON medication_doses
BEGIN
  DELETE FROM activity_events WHERE kind = 'dose' AND record_id = OLD.id;
END;
