-- Ordering assistant: one row per chat turn. Backs the per-dealer rate limit and
-- the agent call log. in_flight_dealer_id is set only while a turn runs, so its
-- unique index lets at most one turn per dealer be in flight (NULLs never collide).
CREATE TABLE "agent_requests" (
    "id" BIGSERIAL NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "in_flight_dealer_id" BIGINT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "model" TEXT,
    "latency_ms" INTEGER,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "tool_calls" JSONB,
    "error" TEXT,

    CONSTRAINT "agent_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_requests_in_flight_dealer_id_key" ON "agent_requests"("in_flight_dealer_id");

CREATE INDEX "agent_requests_dealer_id_started_at_idx" ON "agent_requests"("dealer_id", "started_at");

ALTER TABLE "agent_requests" ADD CONSTRAINT "agent_requests_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
