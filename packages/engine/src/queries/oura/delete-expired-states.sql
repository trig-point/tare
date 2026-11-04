DELETE FROM oura_states WHERE expires_at <= :now;
