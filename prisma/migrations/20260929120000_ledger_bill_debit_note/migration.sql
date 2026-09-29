-- AlterTable
ALTER TABLE "ledger_bills" ADD COLUMN     "debit_note_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "debit_note_reason" TEXT;
