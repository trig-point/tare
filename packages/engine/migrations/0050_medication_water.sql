ALTER TABLE medications ADD COLUMN water_ml INTEGER CHECK (water_ml BETWEEN 1 AND 10000);
ALTER TABLE medication_doses ADD COLUMN water_ml INTEGER CHECK (water_ml IS NULL OR (water_ml > 0 AND status = 'taken'));
