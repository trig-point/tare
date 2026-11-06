DELETE FROM calendar_cache WHERE user_id = :user_id AND day < date(:day, '-2 days');
