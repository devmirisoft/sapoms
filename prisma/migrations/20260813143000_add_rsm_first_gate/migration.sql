ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rsm_approval_status "OrderAcceptanceStatus" NOT NULL DEFAULT 'AWAITING',
  ADD COLUMN IF NOT EXISTS rsm_reviewed_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS rsm_reviewed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS rsm_reviewed_at TIMESTAMPTZ(6);

ALTER TABLE custom_discount_requests
  ADD COLUMN IF NOT EXISTS rsm_approval_status "DiscountRequestStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS rsm_reviewed_by_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS rsm_reviewed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS rsm_reviewed_at TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS orders_rsm_approval_status_idx ON orders(rsm_approval_status);
CREATE INDEX IF NOT EXISTS custom_discount_requests_rsm_approval_status_status_created_at_idx ON custom_discount_requests(rsm_approval_status, status, created_at);