SELECT compat_items.id, compat_groups.name FROM compat_items LEFT JOIN compat_groups ON compat_groups.id = compat_items.group_id ORDER BY compat_items.id;
