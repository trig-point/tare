SELECT id FROM questions WHERE user_id = :user_id AND subject_ref = :subject_ref
AND kind = :kind AND status = 'open' LIMIT 1;
