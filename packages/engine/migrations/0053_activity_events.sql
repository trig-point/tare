-- AUTOINCREMENT: record rowids are reused after a delete, so they cannot mark which events were already sent.
CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users (id),
  payload TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;

CREATE TRIGGER activity_event_food AFTER INSERT ON intake_entries
BEGIN
  INSERT INTO activity_events (user_id, payload) VALUES (NEW.user_id, json_object(
    'event_type', 'food_logged', 'name', NEW.name, 'kcal', NEW.kcal, 'protein_g', NEW.protein_g,
    'slot', (SELECT name FROM template_slots WHERE user_id = NEW.user_id
      AND template_id = NEW.slot_template_id AND position = NEW.slot_position)));
END;

CREATE TRIGGER activity_event_weight AFTER INSERT ON weights
BEGIN
  INSERT INTO activity_events (user_id, payload)
  VALUES (NEW.user_id, json_object('event_type', 'weight_logged', 'kg', NEW.weight_kg));
END;

CREATE TRIGGER activity_event_workout AFTER INSERT ON activity_sessions
BEGIN
  INSERT INTO activity_events (user_id, payload) VALUES (NEW.user_id, json_object(
    'event_type', 'workout_logged', 'kind', NEW.kind, 'duration_minutes', NEW.duration_minutes));
END;

-- Medications belong to the install, not a user, so a NULL user_id reaches every person. Undo returns to scheduled and fires nothing; stopped skips are not logged by anyone.
CREATE TRIGGER activity_event_dose AFTER UPDATE OF status ON medication_doses
WHEN NEW.status != OLD.status AND (NEW.status = 'taken' OR NEW.skip_reason = 'user')
BEGIN
  INSERT INTO activity_events (user_id, payload) VALUES (NULL, json_object(
    'event_type', 'dose_logged', 'medication', (SELECT name FROM medications WHERE id = NEW.medication_id),
    'status', NEW.status));
END;
