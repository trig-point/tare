INSERT INTO compat_items (id, label) VALUES (:id, :label) ON CONFLICT (id) DO UPDATE SET label = excluded.label RETURNING id, label;
