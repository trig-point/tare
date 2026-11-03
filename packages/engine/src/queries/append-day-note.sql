INSERT INTO days (user_id, day, notes)
VALUES (:user_id, :day, :note)
ON CONFLICT (user_id, day) DO UPDATE SET
    notes = CASE WHEN days.notes IS NULL OR days.notes = '' THEN :note
        ELSE days.notes || char(10) || :note END
RETURNING day, signed_off_at, hunger, fullness, notes;
