UPDATE pantry_attempts SET outcome = :outcome, reason = :reason, http_status = :http_status, receipt = :receipt, finished_at = :finished_at WHERE token = :token AND outcome = 'sending';
