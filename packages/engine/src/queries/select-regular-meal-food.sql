SELECT archived_at, restaurant, baseline FROM regular_meals WHERE user_id = :user_id AND food_id = :id;
