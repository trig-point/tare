ALTER TABLE medications ADD COLUMN water_ml INTEGER CHECK (water_ml BETWEEN 1 AND 10000);
ALTER TABLE medication_doses ADD COLUMN water_ml INTEGER CHECK (water_ml IS NULL OR (water_ml > 0 AND status = 'taken'));
ALTER TABLE medication_doses ADD COLUMN water_day TEXT CHECK ((water_day IS NULL) = (water_ml IS NULL) AND (water_day IS NULL OR date(water_day, '+0 days') IS water_day));
