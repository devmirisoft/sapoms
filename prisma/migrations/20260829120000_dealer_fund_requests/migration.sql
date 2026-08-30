-- Advance Dealer Order / Fund Request workflow.

CREATE TYPE "FundRequestType" AS ENUM ('ADVANCE_ORDER', 'ADDITIONAL_FUNDS');

CREATE TYPE "FundRequestStatus" AS ENUM (
  'REQUESTED',
  'RSM_APPROVED',
  'STAFF_APPROVED',
  'FUNDED',
  'COMPLETED',
  'REJECTED'
);

CREATE TABLE "dealer_fund_requests" (
  "id" BIGSERIAL NOT NULL,
  "dealer_id" BIGINT NOT NULL,
  "type" "FundRequestType" NOT NULL,
  "status" "FundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "amount_paise" BIGINT NOT NULL,
  "wallet_balance_paise" BIGINT NOT NULL DEFAULT 0,
  "order_amount_paise" BIGINT,
  "order_form_snapshot" JSONB,
  "order_id" BIGINT,
  "dealer_note" TEXT,
  "rsm_user_id" BIGINT,
  "staff_id" BIGINT,
  "rsm_reviewed_by_user_id" BIGINT,
  "rsm_reviewed_by_name" TEXT,
  "rsm_reviewed_at" TIMESTAMPTZ(6),
  "rsm_note" TEXT,
  "staff_reviewed_by_user_id" BIGINT,
  "staff_reviewed_by_name" TEXT,
  "staff_reviewed_at" TIMESTAMPTZ(6),
  "staff_note" TEXT,
  "accountant_user_id" BIGINT,
  "accountant_name" TEXT,
  "funded_at" TIMESTAMPTZ(6),
  "accountant_note" TEXT,
  "wallet_transaction_id" BIGINT,
  "rejected_at" TIMESTAMPTZ(6),
  "rejected_by" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "dealer_fund_requests_pkey" PRIMARY KEY ("id")
);

-- One order per request and one request per order: the auto-placement guard.
CREATE UNIQUE INDEX "dealer_fund_requests_order_id_key" ON "dealer_fund_requests"("order_id");
-- One wallet credit per request: the double-funding guard.
CREATE UNIQUE INDEX "dealer_fund_requests_wallet_transaction_id_key" ON "dealer_fund_requests"("wallet_transaction_id");

CREATE INDEX "dealer_fund_requests_dealer_id_status_idx" ON "dealer_fund_requests"("dealer_id", "status");
CREATE INDEX "dealer_fund_requests_status_created_at_idx" ON "dealer_fund_requests"("status", "created_at");
CREATE INDEX "dealer_fund_requests_rsm_user_id_status_idx" ON "dealer_fund_requests"("rsm_user_id", "status");
CREATE INDEX "dealer_fund_requests_staff_id_status_idx" ON "dealer_fund_requests"("staff_id", "status");

ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_rsm_user_id_fkey"
  FOREIGN KEY ("rsm_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_rsm_reviewed_by_user_id_fkey"
  FOREIGN KEY ("rsm_reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_staff_reviewed_by_user_id_fkey"
  FOREIGN KEY ("staff_reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_accountant_user_id_fkey"
  FOREIGN KEY ("accountant_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_fund_requests" ADD CONSTRAINT "dealer_fund_requests_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
