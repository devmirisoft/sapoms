-- Used credit is now ordered minus paid, so the consumed-temp counter is unused.
ALTER TABLE "dealer_profiles" DROP COLUMN "temp_credit_consumed_paise";

-- One order can carry several bills (one per partial dispatch).
DROP INDEX "ledger_bills_dealer_id_order_number_key";
