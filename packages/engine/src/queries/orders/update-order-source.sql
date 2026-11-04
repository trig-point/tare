UPDATE orders SET status = :status, applied_email_id = :applied_email_id
WHERE user_id = :user_id AND id = :id;
