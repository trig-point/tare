SELECT * FROM planned_items
WHERE user_id = :user_id AND day = :day AND template_id = :template_id
ORDER BY position, id;
