SELECT count(*) AS open FROM grocery_requests WHERE state IN ('open', 'binding_pending');
