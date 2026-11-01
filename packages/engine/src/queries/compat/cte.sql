WITH selected AS (SELECT id, label FROM compat_items WHERE id >= :minimum) SELECT id, label FROM selected ORDER BY id;
