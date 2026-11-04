UPDATE inbound_emails SET disposition = :disposition, disposition_at = :now,
manual_result = :manual_result, applied_order_id = :applied_order_id, updated_at = :now
WHERE user_id = :user_id AND id = :id;
