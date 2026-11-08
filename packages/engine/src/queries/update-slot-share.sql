UPDATE template_slots SET share_bp = :share_bp
WHERE user_id = :user_id AND template_id = :template_id AND position = :position
RETURNING position;
