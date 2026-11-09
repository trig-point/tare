CREATE TABLE install (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  id TEXT NOT NULL CHECK (length(id) = 16 AND id NOT GLOB '*[^0-9a-f]*')
) STRICT;
INSERT INTO install (singleton, id) VALUES (1, lower(hex(randomblob(8))));

-- No foreign key: a row outlives its person so the retained topic can still be cleared.
CREATE TABLE ha_entities (
  user_id INTEGER NOT NULL,
  topic TEXT NOT NULL CHECK (length(topic) > 0),
  PRIMARY KEY (user_id, topic)
) STRICT, WITHOUT ROWID;
