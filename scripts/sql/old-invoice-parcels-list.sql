/* Read only: changes nothing. Step 1 of 2 for invoices saved before shipment billing.

   Those invoices were saved against orders, so they don't record which parcels they include.
   This writes old-invoice-parcels.csv (in the folder psql is run from): one row per invoice and
   parcel of its orders that no invoice covers yet. Accounts fill the last column, "included",
   with Y or N from the invoice copy; then link-old-invoice-parcels.sql applies exactly that.

   Run: psql "<database>" -f scripts/sql/old-invoice-parcels-list.sql
   parcel_value_before_gst is approximate (the parcel's share of the order's net); it is a hint
   for matching the invoice, not an amount to bill. */
\set QUIET on
\set ON_ERROR_STOP on
BEGIN READ ONLY;

\o old-invoice-parcels.csv
COPY (
  WITH bill_orders AS (
    SELECT DISTINCT b.id AS bill_id, o.id AS order_id
    FROM ledger_bills b
    CROSS JOIN LATERAL unnest(string_to_array(b.order_number, ',')) AS k(stored)
    JOIN orders o ON o.dealer_id = b.dealer_id
     AND (o.legacy_php_id = trim(k.stored) OR (o.legacy_php_id IS NULL AND o.id::text = trim(k.stored)))
  ),
  candidates AS (
    SELECT bo.bill_id, s.id AS shipment_id, s.order_id
    FROM bill_orders bo
    JOIN order_shipments s ON s.order_id = bo.order_id AND s.ledger_bill_id IS NULL
    JOIN orders o ON o.id = s.order_id AND o.status <> 'CANCELLED'
    WHERE EXISTS (SELECT 1 FROM order_item_dispatches x WHERE x.shipment_id = s.id AND x.quantity > 0)
  ),
  order_net AS (
    SELECT o.id AS order_id, o.final_payable_amount_paise::numeric / NULLIF(sum(i.final_amount_paise), 0) AS ratio
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.id IN (SELECT order_id FROM candidates)
    GROUP BY o.id, o.final_payable_amount_paise
  ),
  parcel_value AS (
    SELECT x.shipment_id, round(sum(i.final_amount_paise::numeric * x.quantity / NULLIF(i.quantity_packs, 0)) * max(n.ratio) / 100, 2) AS value
    FROM order_item_dispatches x
    JOIN order_items i ON i.id = x.order_item_id
    JOIN order_net n ON n.order_id = x.order_id
    WHERE x.shipment_id IN (SELECT shipment_id FROM candidates)
    GROUP BY x.shipment_id
  )
  SELECT c.bill_id AS invoice_id, b.bill_number AS invoice_no, b.bill_date AS invoice_date, b.bill_amount_paise / 100.0 AS invoice_amount_incl_gst,
         p.business_name AS dealer,
         /* The number staff know, even before renumber-app-orders.sql has run. */
         CASE WHEN o.legacy_php_id IS NULL
              THEN 'OM/' || lpad((y.fy % 100)::text, 2, '0') || '-' || lpad(((y.fy + 1) % 100)::text, 2, '0') || '/DMS-' || lpad(o.id::text, greatest(3, length(o.id::text)), '0')
              ELSE o.order_number END AS order_no,
         s.id AS parcel_id, s.dispatch_partner AS courier, s.tracking_number AS tracking, (s.created_at AT TIME ZONE 'Asia/Kolkata')::date AS dispatched,
         v.value AS parcel_value_before_gst,
         CASE WHEN count(*) OVER (PARTITION BY c.bill_id, c.order_id) = 1 THEN 'only parcel of this order'
              ELSE 'order has ' || count(*) OVER (PARTITION BY c.bill_id, c.order_id) || ' parcels: check the invoice copy' END AS hint,
         NULL::text AS included
  FROM candidates c
  JOIN ledger_bills b ON b.id = c.bill_id
  JOIN dealer_profiles p ON p.id = b.dealer_id
  JOIN order_shipments s ON s.id = c.shipment_id
  JOIN orders o ON o.id = c.order_id
  CROSS JOIN LATERAL (
    SELECT (extract(year FROM o.order_date AT TIME ZONE 'Asia/Kolkata')
            - CASE WHEN extract(month FROM o.order_date AT TIME ZONE 'Asia/Kolkata') < 4 THEN 1 ELSE 0 END)::int AS fy
  ) y
  LEFT JOIN parcel_value v ON v.shipment_id = c.shipment_id
  ORDER BY p.business_name, b.bill_number, o.id, s.created_at, s.id
) TO STDOUT WITH (FORMAT csv, HEADER true);
\o

ROLLBACK;
