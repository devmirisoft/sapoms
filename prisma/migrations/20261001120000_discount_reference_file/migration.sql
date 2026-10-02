-- Optional supporting document attached to a custom discount request.
ALTER TABLE "custom_discount_requests"
  ADD COLUMN "reference_file_url" TEXT,
  ADD COLUMN "reference_file_public_id" TEXT,
  ADD COLUMN "reference_file_name" TEXT,
  ADD COLUMN "reference_file_type" TEXT;
