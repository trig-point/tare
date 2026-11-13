SELECT pantry_bindings.reference_kind, pantry_bindings.reference_id, foods.name
FROM pantry_bindings
JOIN foods ON foods.user_id = pantry_bindings.user_id AND foods.id = pantry_bindings.reference_id
WHERE pantry_bindings.user_id = :user_id AND pantry_bindings.generation = :generation AND pantry_bindings.reference_kind = 'food'
UNION ALL
SELECT pantry_bindings.reference_kind, pantry_bindings.reference_id, source_foods.name
FROM pantry_bindings
JOIN source_foods ON source_foods.id = pantry_bindings.reference_id
WHERE pantry_bindings.user_id = :user_id AND pantry_bindings.generation = :generation AND pantry_bindings.reference_kind = 'source_food';
