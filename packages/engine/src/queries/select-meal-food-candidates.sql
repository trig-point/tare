SELECT * FROM foods
WHERE user_id = :user_id AND service IS NOT NULL AND meal_name IS NOT NULL
ORDER BY id;
