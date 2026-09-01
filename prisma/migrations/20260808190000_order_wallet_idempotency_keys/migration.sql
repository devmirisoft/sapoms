ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_key
  ON orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_key_key
  ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
