ALTER TABLE customers ALTER COLUMN area_id DROP NOT NULL;
ALTER TABLE customers ADD COLUMN representative_id uuid REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX customers_representative ON customers(representative_id,active,name,id);
ALTER TABLE products ADD COLUMN weight double precision;
ALTER TABLE products ADD COLUMN weight_unit text NOT NULL DEFAULT '';
ALTER TABLE products ADD CONSTRAINT products_weight_positive CHECK (weight IS NULL OR (weight > 0 AND weight < 'Infinity'::float8));
