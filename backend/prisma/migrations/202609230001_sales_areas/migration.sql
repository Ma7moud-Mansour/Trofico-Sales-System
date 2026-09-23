CREATE TABLE areas(
  id uuid PRIMARY KEY,
  name text NOT NULL,
  name_normalized text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1
);

INSERT INTO areas(id,name,name_normalized) VALUES
  ('10000000-0000-4000-8000-000000000001','منطقة الشرقية والقناة','منطقة الشرقية والقناة'),
  ('10000000-0000-4000-8000-000000000002','منطقة الدقهلية ودمياط','منطقة الدقهلية ودمياط'),
  ('10000000-0000-4000-8000-000000000003','قليوبية ومنوفية','قليوبية ومنوفية'),
  ('10000000-0000-4000-8000-000000000004','الغربية وكفر الشيخ','الغربية وكفر الشيخ'),
  ('10000000-0000-4000-8000-000000000005','البحيرة والإسكندرية','البحيرة والإسكندرية'),
  ('10000000-0000-4000-8000-000000000006','القاهرة والجيزة','القاهرة والجيزة'),
  ('10000000-0000-4000-8000-000000000007','الفيوم وبني سويف','الفيوم وبني سويف'),
  ('10000000-0000-4000-8000-000000000008','المنيا وأسيوط','المنيا وأسيوط'),
  ('10000000-0000-4000-8000-000000000009','قنا والأقصر','قنا والأقصر'),
  ('10000000-0000-4000-8000-000000000010','المنيا وأسيوط - دوا ميكرز','المنيا وأسيوط - دوا ميكرز');

ALTER TABLE customers ADD COLUMN area_id uuid;
UPDATE customers SET area_id='10000000-0000-4000-8000-000000000006'::uuid;
ALTER TABLE customers
  ALTER COLUMN area_id SET NOT NULL,
  ADD CONSTRAINT customers_area_id_fkey FOREIGN KEY(area_id) REFERENCES areas(id) ON DELETE RESTRICT;
CREATE INDEX customers_area ON customers(area_id,active,name,id);

CREATE TABLE user_areas(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  PRIMARY KEY(user_id,area_id)
);
CREATE INDEX user_areas_area ON user_areas(area_id,user_id);

INSERT INTO user_areas(user_id,area_id)
SELECT DISTINCT r.user_id,'10000000-0000-4000-8000-000000000006'::uuid
FROM user_roles r
JOIN users u ON u.id=r.user_id
WHERE r.role='SALES_REP';

UPDATE products SET unit='عبوة',version=version+1 WHERE unit<>'عبوة';
UPDATE order_items
SET product_snapshot=jsonb_set(product_snapshot,'{unit}','"عبوة"'::jsonb)
WHERE product_snapshot->>'unit'<>'عبوة';
