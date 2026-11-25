DELETE FROM movements WHERE user_id = :user_id AND lower(name) = lower(:name) RETURNING id;
