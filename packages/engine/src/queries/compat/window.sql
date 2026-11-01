SELECT id, row_number() OVER (ORDER BY id) AS position FROM compat_items ORDER BY id;
