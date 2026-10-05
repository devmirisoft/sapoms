-- Ordering assistant drafts: priced by the server, placed only by the dealer's
-- Confirm click. CONFIRMING is the atomic claim against double submission.
CREATE TYPE "AgentDraftStatus" AS ENUM ('PENDING', 'CONFIRMING', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "agent_drafts" (
    "id" TEXT NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "status" "AgentDraftStatus" NOT NULL DEFAULT 'PENDING',
    "items" JSONB NOT NULL,
    "notes" TEXT,
    "custom_discount" JSONB,
    "summary" JSONB NOT NULL,
    "payable_paise" BIGINT NOT NULL,
    "order_id" BIGINT,
    "custom_discount_request_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_drafts_order_id_key" ON "agent_drafts"("order_id");

CREATE UNIQUE INDEX "agent_drafts_custom_discount_request_id_key" ON "agent_drafts"("custom_discount_request_id");

CREATE INDEX "agent_drafts_dealer_id_created_at_idx" ON "agent_drafts"("dealer_id", "created_at");

ALTER TABLE "agent_drafts" ADD CONSTRAINT "agent_drafts_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
