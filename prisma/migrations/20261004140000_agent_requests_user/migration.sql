-- The assistant now serves every role, so its lock, rate limit and log key on the
-- user instead of the dealer. Existing (dealer) rows are backfilled from their dealer.
ALTER TABLE "agent_requests" ADD COLUMN "user_id" BIGINT;
UPDATE "agent_requests" AS r SET "user_id" = d."user_id" FROM "dealer_profiles" AS d WHERE d."id" = r."dealer_id";
ALTER TABLE "agent_requests" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "agent_requests" ALTER COLUMN "dealer_id" DROP NOT NULL;

-- Any turn still marked in flight is abandoned by the switch; it simply ends.
DROP INDEX "agent_requests_in_flight_dealer_id_key";
ALTER TABLE "agent_requests" DROP COLUMN "in_flight_dealer_id";
ALTER TABLE "agent_requests" ADD COLUMN "in_flight_user_id" BIGINT;
CREATE UNIQUE INDEX "agent_requests_in_flight_user_id_key" ON "agent_requests"("in_flight_user_id");

DROP INDEX "agent_requests_dealer_id_started_at_idx";
CREATE INDEX "agent_requests_user_id_started_at_idx" ON "agent_requests"("user_id", "started_at");

ALTER TABLE "agent_requests" ADD CONSTRAINT "agent_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
