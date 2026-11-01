UPDATE compat_items SET label = :label WHERE id >= :minimum RETURNING id, label;
