ALTER TABLE dealer_wallets
  ADD COLUMN IF NOT EXISTS total_credited_paise BIGINT NOT NULL DEFAULT 0;

UPDATE dealer_wallets wallet
SET total_credited_paise = COALESCE(summary.total_credited_paise, 0)
FROM (
  SELECT wallet_id, SUM(amount_paise) AS total_credited_paise
  FROM wallet_transactions
  WHERE type IN ('CREDIT', 'REFUND')
  GROUP BY wallet_id
) summary
WHERE wallet.id = summary.wallet_id;