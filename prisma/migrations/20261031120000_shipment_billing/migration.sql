-- A ledger bill can carry the invoice's own number, and records the shipments
-- it invoiced so Dispatch Tracking can split billed from unbilled shipments.
ALTER TABLE "ledger_bills" ADD COLUMN "bill_number" TEXT;

-- NULLs never collide, so bills saved without a number are unaffected.
CREATE UNIQUE INDEX "ledger_bills_dealer_id_bill_number_key" ON "ledger_bills"("dealer_id", "bill_number");

ALTER TABLE "order_shipments" ADD COLUMN "ledger_bill_id" BIGINT;

CREATE INDEX "order_shipments_ledger_bill_id_idx" ON "order_shipments"("ledger_bill_id");

ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_ledger_bill_id_fkey" FOREIGN KEY ("ledger_bill_id") REFERENCES "ledger_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
