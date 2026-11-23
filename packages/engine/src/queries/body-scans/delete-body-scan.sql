DELETE FROM body_scans WHERE user_id = :user_id AND id = :id RETURNING id;
