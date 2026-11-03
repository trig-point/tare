INSERT INTO questions (user_id, kind, subject_ref, prompt, answer_schema, status, created_at)
VALUES (:user_id, :kind, :subject_ref, :prompt, :answer_schema, 'open', :created_at)
RETURNING *;
