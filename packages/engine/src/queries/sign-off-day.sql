INSERT INTO days (user_id, day, signed_off_at, hunger, fullness, notes)
VALUES (:user_id, :day, :signed_off_at, :hunger, :fullness, :notes)
ON CONFLICT (user_id, day) DO UPDATE SET
    signed_off_at = :signed_off_at,
    hunger = CASE WHEN :set_hunger THEN :hunger ELSE days.hunger END,
    fullness = CASE WHEN :set_fullness THEN :fullness ELSE days.fullness END,
    notes = CASE WHEN :set_notes THEN :notes ELSE days.notes END
RETURNING day, signed_off_at, hunger, fullness, notes;
