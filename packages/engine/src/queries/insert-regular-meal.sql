INSERT INTO regular_meals (user_id, food_id, restaurant, baseline, created_at)
VALUES (:user_id, :food_id, :restaurant, :baseline, :created_at) RETURNING food_id;
