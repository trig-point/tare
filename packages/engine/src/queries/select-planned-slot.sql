SELECT * FROM planned_items
WHERE user_id = :user_id AND day = :day AND template_id = :template_id AND position = :position
AND state = 'planned' LIMIT 1;
