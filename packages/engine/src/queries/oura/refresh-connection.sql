UPDATE oura_connections SET
  version = :version, ciphertext = :ciphertext, iv = :iv, tag = :tag,
  access_expires_at = :access_expires_at, scopes = :scopes, scope_source = :scope_source,
  status = CASE WHEN status = 'membership_required' THEN status ELSE 'connected' END,
  generation = generation + 1, updated_at = :now
WHERE user_id = :user_id AND generation = :generation
RETURNING generation;
