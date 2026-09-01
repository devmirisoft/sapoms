CREATE TABLE "ledger_bills" (
  "id" BIGSERIAL NOT NULL,
  "dealer_id" BIGINT NOT NULL,
  "order_id" BIGINT,
  "order_number" TEXT NOT NULL,
  "bill_amount_paise" BIGINT NOT NULL DEFAULT 0,
  "gst_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "bill_date" DATE NOT NULL,
  "pdf_name" TEXT,
  "pdf_url" TEXT,
  "paid_amount_paise" BIGINT NOT NULL DEFAULT 0,
  "last_payment_date" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ledger_bills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_bills_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ledger_bills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ledger_bills_dealer_id_order_number_key" ON "ledger_bills"("dealer_id", "order_number");
CREATE INDEX "ledger_bills_dealer_id_bill_date_idx" ON "ledger_bills"("dealer_id", "bill_date");
CREATE INDEX "ledger_bills_order_id_idx" ON "ledger_bills"("order_id");