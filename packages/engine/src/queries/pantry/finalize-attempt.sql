UPDATE pantry_attempts SET outcome = :outcome, reason = :reason, http_status = :http_status, receipt = :receipt, finished_at = :finished_at,
  uncertain_since = CASE WHEN :outcome = 'uncertain' THEN :finished_at END
WHERE token = :token AND outcome = 'sending';
