-- NSM review stage between RSM and Admin for large custom discounts.
-- NULL nsm_approval_status means the request does not need NSM review.
ALTER TABLE "custom_discount_requests"
  ADD COLUMN "nsm_approval_status" "DiscountRequestStatus",
  ADD COLUMN "nsm_reviewed_by_user_id" BIGINT,
  ADD COLUMN "nsm_reviewed_by_name" TEXT,
  ADD COLUMN "nsm_reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "nsm_note" TEXT;
