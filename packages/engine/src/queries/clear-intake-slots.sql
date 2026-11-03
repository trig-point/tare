UPDATE intake_entries SET slot_template_id = NULL, slot_position = NULL WHERE user_id = :user_id AND slot_template_id = :template_id;
