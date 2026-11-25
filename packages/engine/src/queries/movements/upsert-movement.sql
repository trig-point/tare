INSERT INTO movements (user_id, name, setup, cues, mistakes, safety, pictures, rest_seconds, source, equipment, updated_at)
VALUES (:user_id, :name, :setup, :cues, :mistakes, :safety, :pictures, :rest_seconds, :source, :equipment, :updated_at)
ON CONFLICT (user_id, name COLLATE NOCASE) DO UPDATE SET
  name = excluded.name, setup = excluded.setup, cues = excluded.cues, mistakes = excluded.mistakes, safety = excluded.safety,
  pictures = excluded.pictures, rest_seconds = excluded.rest_seconds, source = excluded.source, equipment = excluded.equipment,
  updated_at = excluded.updated_at
RETURNING id;
