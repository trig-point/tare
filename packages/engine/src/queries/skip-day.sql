UPDATE days
SET skipped_at = :skipped_at
WHERE user_id = :user_id AND day = :day AND signed_off_at IS NULL
RETURNING day;
