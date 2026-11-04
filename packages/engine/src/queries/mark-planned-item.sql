UPDATE planned_items SET state = :state, revision = revision + 1, updated_at = :updated_at
WHERE user_id = :user_id AND id = :id AND revision = :revision AND state = 'planned'
RETURNING id, revision, state;
