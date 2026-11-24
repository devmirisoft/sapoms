/* One-time: give orders placed in this app the number staff know them by.

   App orders were numbered from a yearly counter (OM/26-27/DMS-1083) while most screens
   showed their row id (DMS-2250). New orders now save OM/<financial year>/DMS-<id>
   (src/lib/orderIdentity.ts); this rewrites the existing ones the same way, with the
   financial year (April to March, IST) of each order's own date.

   Touches only orders with no legacy_php_id: old PHP orders keep their numbers. Also
   rewrites the copies the account book and fund requests show (wallet_transactions
   reference and metadata.orderNumber). Audit history and sent emails stay as they were.

   Run after deploying the code that numbers new orders this way. Safe to run again: an
   order already numbered this way is skipped. Stops without changing anything if a new
   number is already taken. Safe to paste as one line: no line comments. */
BEGIN;

CREATE TEMP TABLE renumber ON COMMIT DROP AS
SELECT o.id, o.order_number AS old_number,
       'OM/' || lpad((y.fy % 100)::text, 2, '0') || '-' || lpad(((y.fy + 1) % 100)::text, 2, '0') || '/DMS-' || lpad(o.id::text, greatest(3, length(o.id::text)), '0') AS new_number
FROM orders o
CROSS JOIN LATERAL (
  SELECT (extract(year FROM o.order_date AT TIME ZONE 'Asia/Kolkata')
          - CASE WHEN extract(month FROM o.order_date AT TIME ZONE 'Asia/Kolkata') < 4 THEN 1 ELSE 0 END)::int AS fy
) y
WHERE o.legacy_php_id IS NULL;

DELETE FROM renumber WHERE old_number = new_number;

DO $$
DECLARE taken int;
BEGIN
  SELECT count(*) INTO taken FROM renumber r JOIN orders o ON o.order_number = r.new_number AND o.id <> r.id;
  IF taken > 0 THEN RAISE EXCEPTION '% new number(s) already belong to another order; nothing changed', taken; END IF;
END $$;

SELECT id, old_number, new_number FROM renumber ORDER BY id;

UPDATE wallet_transactions t SET reference = r.new_number
FROM renumber r WHERE t.order_id = r.id AND t.reference = r.old_number;

UPDATE wallet_transactions t SET metadata = jsonb_set(t.metadata::jsonb, '{orderNumber}', to_jsonb(r.new_number))
FROM renumber r WHERE t.order_id = r.id AND t.metadata->>'orderNumber' = r.old_number;

UPDATE orders o SET order_number = r.new_number, updated_at = now()
FROM renumber r WHERE o.id = r.id;

COMMIT;
