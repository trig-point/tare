DELETE FROM oura_states
WHERE state_hash = :state_hash AND user_id = :user_id AND expires_at > :now
RETURNING verifier, generation;
