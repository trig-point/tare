UPDATE pantry_requests SET state = :state, updated_at = :now,
  reason = CASE WHEN :state = 'pending' THEN NULL ELSE reason END,
  uncertain_since = CASE WHEN :state = 'pending' THEN NULL ELSE uncertain_since END,
  resolved_at = CASE WHEN :state = 'pending' THEN resolved_at ELSE :now END
WHERE id = :id AND state = :expected AND attempt_count = :number RETURNING id;
