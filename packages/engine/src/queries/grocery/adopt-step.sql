UPDATE grocery_steps SET state = 'adopted', object_id = :object_id, transaction_id = :transaction_id, updated_at = :now
WHERE request_id = :request_id AND number = :number AND state = 'uncertain'
RETURNING kind;
