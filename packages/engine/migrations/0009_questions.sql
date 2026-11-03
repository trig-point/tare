CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer_schema TEXT NOT NULL CHECK (json_valid(answer_schema)),
  status TEXT NOT NULL CHECK (status IN ('open', 'answered')),
  answer TEXT CHECK (answer IS NULL OR json_valid(answer)),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') IS created_at),
  answered_at TEXT CHECK (answered_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', answered_at, '+0 seconds') IS answered_at),
  UNIQUE (user_id, id)
) STRICT;
CREATE INDEX questions_user_status_id ON questions(user_id, status, id);
