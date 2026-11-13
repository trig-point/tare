UPDATE grocery_requests SET state = 'abandoned', updated_at = :now
WHERE id = :id AND state IN ('open', 'binding_pending') AND NOT EXISTS (SELECT 1 FROM grocery_steps WHERE request_id = :id AND state = 'sending')
RETURNING id;
