ALTER TABLE "ledger_bills"
  ADD COLUMN IF NOT EXISTS "pdf_files" JSONB;
