INSERT INTO oura_connections (
  user_id, version, ciphertext, iv, tag, access_expires_at, scopes, scope_source,
  status, generation, created_at, updated_at
)
SELECT :user_id, :version, :ciphertext, :iv, :tag, :access_expires_at, :scopes, :scope_source,
  'connected', 1, :now, :now
WHERE :generation = 0
ON CONFLICT(user_id) DO NOTHING
RETURNING generation;
