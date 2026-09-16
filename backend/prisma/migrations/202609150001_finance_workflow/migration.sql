ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders
  ADD COLUMN finance_recommendation text,
  ADD COLUMN finance_note text,
  ADD COLUMN finance_reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN finance_reviewed_at timestamptz;

UPDATE orders SET status='PENDING_MANAGER' WHERE status='PENDING_APPROVAL';

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK(status IN (
    'DRAFT','PENDING_FINANCE','PENDING_MANAGER','MANAGER_APPROVED',
    'WAREHOUSE_CONFIRMED','IN_TRANSIT','DELIVERED','REJECTED','CANCELLED'
  )),
  ADD CONSTRAINT orders_finance_recommendation_check
    CHECK(finance_recommendation IS NULL OR finance_recommendation IN ('APPROVE','REJECT'));

CREATE INDEX orders_finance_queue
  ON orders(status,finance_reviewed_at,id)
  WHERE status IN ('PENDING_FINANCE','PENDING_MANAGER');

CREATE TABLE stock_receipts(
  id uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK(quantity>0),
  reason text NOT NULL CHECK(length(trim(reason))>0),
  status text NOT NULL CHECK(status IN ('PENDING_FINANCE','APPROVED','REJECTED')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_name_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  finance_note text,
  version integer NOT NULL DEFAULT 1,
  CHECK(
    (status='PENDING_FINANCE' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (status IN ('APPROVED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX stock_receipts_queue
  ON stock_receipts(status,created_at,id);
