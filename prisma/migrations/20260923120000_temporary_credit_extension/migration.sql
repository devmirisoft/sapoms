-- AlterTable
ALTER TABLE "dealer_profiles" ADD COLUMN     "temp_credit_limit_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "temp_credit_consumed_paise" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ledger_bills" ADD COLUMN     "extra_credit_days" INTEGER NOT NULL DEFAULT 0;
