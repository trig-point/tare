SELECT generation, request_id, reason FROM pantry_outcomes WHERE user_id = :user_id AND intake_id = :intake_id;
