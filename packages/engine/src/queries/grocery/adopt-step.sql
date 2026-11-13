UPDATE grocery_steps SET state = 'adopted', object_id = :object_id, transaction_id = :transaction_id, product_id = coalesce(product_id, :product_id), updated_at = :now
WHERE request_id = :request_id AND number = :number AND state = 'uncertain'
  AND ((kind = 'stock_add' AND :transaction_id IS NOT NULL AND :product_id IS NOT NULL AND (product_id IS NULL OR product_id = :product_id))
    OR (kind != 'stock_add' AND :object_id IS NOT NULL))
RETURNING kind;
