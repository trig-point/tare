UPDATE oura_connections SET status = 'reconnect_required'
WHERE user_id = :user_id AND generation = :generation
RETURNING generation;
