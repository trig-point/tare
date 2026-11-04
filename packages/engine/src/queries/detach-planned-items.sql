UPDATE planned_items SET template_id = NULL, position = NULL,
revision = revision + CASE WHEN state = 'planned' THEN 1 ELSE 0 END, updated_at = :updated_at
WHERE user_id = :user_id AND template_id = :template_id;
