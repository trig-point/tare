ALTER TABLE weights ADD COLUMN note TEXT CHECK (instr(note, char(0)) = 0 AND length(note) <= 200);
