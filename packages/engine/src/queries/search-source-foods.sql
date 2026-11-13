SELECT id, name, brand, serving_size, serving_unit FROM source_foods
WHERE name LIKE '%' || :pattern || '%' ESCAPE '!'
ORDER BY name, id
LIMIT 20;
