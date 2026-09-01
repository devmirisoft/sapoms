CREATE TABLE "dealer_requests" (
    "id" BIGSERIAL NOT NULL,
    "request_reference" TEXT,
    "request_identity_key" TEXT NOT NULL,
    "open_request_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dealer_name" TEXT NOT NULL,
    "dealer_code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "assigned_staff_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "assigned_staff_names" TEXT NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "reviewed_by_id" TEXT NOT NULL DEFAULT '',
    "reviewed_by_name" TEXT NOT NULL DEFAULT '',
    "created_dealer_id" TEXT NOT NULL DEFAULT '',
    "rejection_reason" TEXT NOT NULL DEFAULT '',
    "last_rejection_reason" TEXT NOT NULL DEFAULT '',
    "form_snapshot" JSONB NOT NULL,
    "approval_lock" JSONB,
    "audit_trail" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "creation_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "resubmitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dealer_requests_request_reference_key" ON "dealer_requests"("request_reference");
CREATE UNIQUE INDEX "dealer_requests_open_request_key_key" ON "dealer_requests"("open_request_key");
CREATE INDEX "dealer_requests_status_updated_at_idx" ON "dealer_requests"("status", "updated_at");
CREATE INDEX "dealer_requests_submitted_by_id_status_updated_at_idx" ON "dealer_requests"("submitted_by_id", "status", "updated_at");
CREATE INDEX "dealer_requests_dealer_name_idx" ON "dealer_requests"("dealer_name");
CREATE INDEX "dealer_requests_dealer_code_idx" ON "dealer_requests"("dealer_code");