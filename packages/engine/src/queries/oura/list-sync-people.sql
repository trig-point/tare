SELECT oura_connections.user_id, oura_connections.last_synced_at, users.timezone, users.day_start_hour
FROM oura_connections JOIN users ON users.id = oura_connections.user_id
WHERE oura_connections.status != 'reconnect_required'
ORDER BY oura_connections.user_id;
