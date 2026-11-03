INSERT INTO days (user_id, day, hunger, fullness, notes, signed_off_at)
VALUES (:user_id, :day, :hunger, :fullness, :notes, NULL)
ON CONFLICT (user_id, day) DO UPDATE SET
    hunger = COALESCE(days.hunger, :hunger),
    fullness = COALESCE(days.fullness, :fullness),
    notes = COALESCE(days.notes, :notes),
    signed_off_at = NULL;
