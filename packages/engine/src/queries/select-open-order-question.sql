SELECT id FROM questions WHERE user_id = :user_id AND subject_ref = :subject_ref
AND kind = :kind AND status = 'open' AND id <> :excluded_id
AND (:mode IS NULL OR json_extract(answer_schema, '$.mode') = :mode)
LIMIT 1;
