-- Filter Requirement Form submissions (ported from MongoDB to Postgres)

CREATE TABLE IF NOT EXISTS "form_submissions" (
    "id" BIGSERIAL NOT NULL,
    "lead_no" TEXT NOT NULL,
    "products" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "customer_details" JSONB NOT NULL,
    "syringe_filter" JSONB,
    "capsule" JSONB,
    "cartridge_filter" JSONB,
    "commercial_info" JSONB NOT NULL,
    "company_name" TEXT NOT NULL,
    "submitted_by_user_id" BIGINT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_by_role" "UserRole" NOT NULL,
    "visited_date" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_submissions_lead_no_key" ON "form_submissions"("lead_no");
CREATE INDEX IF NOT EXISTS "form_submissions_submitted_by_user_id_visited_date_idx" ON "form_submissions"("submitted_by_user_id", "visited_date");
CREATE INDEX IF NOT EXISTS "form_submissions_visited_date_idx" ON "form_submissions"("visited_date");

ALTER TABLE "form_submissions"
    ADD CONSTRAINT "form_submissions_submitted_by_user_id_fkey"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Atomic lead-number counter (replaces the Mongo "counters" collection)
CREATE TABLE IF NOT EXISTS "form_lead_sequences" (
    "id" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "form_lead_sequences_pkey" PRIMARY KEY ("id")
);

INSERT INTO "form_lead_sequences" ("id", "last_value", "updated_at")
VALUES ('leadNo', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
