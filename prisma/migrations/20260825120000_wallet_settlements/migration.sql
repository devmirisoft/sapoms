-- Advance -> Credit wallet settlement.
-- When a dealer is switched from advance to credit the residual wallet balance
-- is moved out of the wallet into an OPEN settlement, which the accountant then
-- applies against that dealer's bills until nothing remains.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletSettlementStatus') THEN
    CREATE TYPE "WalletSettlementStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "wallet_settlements" (
  "id"                     BIGSERIAL PRIMARY KEY,
  "dealer_id"              BIGINT NOT NULL,
  "original_paise"         BIGINT NOT NULL,
  "remaining_paise"        BIGINT NOT NULL,
  "status"                 "WalletSettlementStatus" NOT NULL DEFAULT 'OPEN',
  "closing_transaction_id" BIGINT,
  "opened_by_user_id"      BIGINT,
  "closed_at"              TIMESTAMPTZ(6),
  "note"                   TEXT,
  "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "wallet_settlement_applications" (
  "id"                    BIGSERIAL PRIMARY KEY,
  "settlement_id"         BIGINT NOT NULL,
  "bill_id"               BIGINT,
  "order_id"              BIGINT,
  "amount_paise"          BIGINT NOT NULL,
  "wallet_transaction_id" BIGINT,
  "idempotency_key"       TEXT,
  "applied_by_user_id"    BIGINT,
  "note"                  TEXT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_settlements_closing_transaction_id_key"
  ON "wallet_settlements" ("closing_transaction_id");
CREATE INDEX IF NOT EXISTS "wallet_settlements_dealer_id_status_idx"
  ON "wallet_settlements" ("dealer_id", "status");
CREATE INDEX IF NOT EXISTS "wallet_settlements_status_created_at_idx"
  ON "wallet_settlements" ("status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_settlement_applications_wallet_transaction_id_key"
  ON "wallet_settlement_applications" ("wallet_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_settlement_applications_idempotency_key_key"
  ON "wallet_settlement_applications" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "wallet_settlement_applications_settlement_id_created_at_idx"
  ON "wallet_settlement_applications" ("settlement_id", "created_at");
CREATE INDEX IF NOT EXISTS "wallet_settlement_applications_bill_id_idx"
  ON "wallet_settlement_applications" ("bill_id");

-- At most one OPEN settlement per dealer, so credit -> advance has a single
-- unambiguous thing to block on.
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_settlements_one_open_per_dealer"
  ON "wallet_settlements" ("dealer_id") WHERE "status" = 'OPEN';

ALTER TABLE "wallet_settlements"
  ADD CONSTRAINT "wallet_settlements_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_settlements"
  ADD CONSTRAINT "wallet_settlements_opened_by_user_id_fkey"
  FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_settlement_applications"
  ADD CONSTRAINT "wallet_settlement_applications_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "wallet_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_settlement_applications"
  ADD CONSTRAINT "wallet_settlement_applications_bill_id_fkey"
  FOREIGN KEY ("bill_id") REFERENCES "ledger_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_settlement_applications"
  ADD CONSTRAINT "wallet_settlement_applications_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_settlement_applications"
  ADD CONSTRAINT "wallet_settlement_applications_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_settlement_applications"
  ADD CONSTRAINT "wallet_settlement_applications_applied_by_user_id_fkey"
  FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
