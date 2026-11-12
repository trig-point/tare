SELECT product_id, status, change_token FROM pantry_bindings WHERE user_id = :user_id AND generation = :generation AND reference_kind = 'food' AND reference_id = :reference_id LIMIT 1;
