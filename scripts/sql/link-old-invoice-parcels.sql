/* Step 2 of 2 for invoices saved before shipment billing: record which parcels each includes.

   Reads old-invoice-parcels.csv (made by old-invoice-parcels-list.sql, "included" filled with
   Y or N by accounts) from the folder psql is run from, and links every Y parcel to its
   invoice, so it counts as billed in Add Invoice and Dispatch Tracking and shows under that
   invoice in Billed Shipments. N parcels stay to bill. Nothing is guessed.

   Stops without changing anything if a row's "included" is not Y or N, a parcel is marked Y
   under more than one invoice, a parcel is not on that invoice's orders, or a parcel is already
   on a different invoice. Safe to run again: parcels already linked to their invoice are skipped.

   Run, after deploying: psql "<database>" -f scripts/sql/link-old-invoice-parcels.sql */
\set QUIET on
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE old_invoice_parcels (
  invoice_id text, invoice_no text, invoice_date text, invoice_amount_incl_gst text, dealer text, order_no text,
  parcel_id text, courier text, tracking text, dispatched text, parcel_value_before_gst text, hint text, included text
) ON COMMIT DROP;
\copy old_invoice_parcels FROM 'old-invoice-parcels.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE marked ON COMMIT DROP AS
SELECT trim(invoice_id)::bigint AS bill_id, trim(parcel_id)::bigint AS shipment_id, upper(trim(coalesce(included, ''))) IN ('Y', 'YES') AS yes
FROM old_invoice_parcels;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT 'invoice ' || invoice_no || ' parcel ' || parcel_id, ', ') INTO bad
  FROM old_invoice_parcels WHERE upper(trim(coalesce(included, ''))) NOT IN ('Y', 'YES', 'N', 'NO');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Fill "included" with Y or N for: %. Nothing changed.', bad; END IF;

  SELECT string_agg(shipment_id::text, ', ') INTO bad
  FROM (SELECT shipment_id FROM marked WHERE yes GROUP BY shipment_id HAVING count(DISTINCT bill_id) > 1) d;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Parcel(s) % marked Y under more than one invoice. Nothing changed.', bad; END IF;

  SELECT string_agg(m.shipment_id::text, ', ') INTO bad
  FROM marked m
  WHERE m.yes AND NOT EXISTS (
    SELECT 1 FROM ledger_bills b
    CROSS JOIN LATERAL unnest(string_to_array(b.order_number, ',')) AS k(stored)
    JOIN orders o ON o.dealer_id = b.dealer_id
     AND (o.legacy_php_id = trim(k.stored) OR (o.legacy_php_id IS NULL AND o.id::text = trim(k.stored)))
    JOIN order_shipments s ON s.order_id = o.id
    WHERE b.id = m.bill_id AND s.id = m.shipment_id
  );
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Parcel(s) % are not on the orders of the invoice they are marked under. Nothing changed.', bad; END IF;

  SELECT string_agg(m.shipment_id::text, ', ') INTO bad
  FROM marked m JOIN order_shipments s ON s.id = m.shipment_id
  WHERE m.yes AND s.ledger_bill_id IS NOT NULL AND s.ledger_bill_id <> m.bill_id;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Parcel(s) % are already on a different invoice. Nothing changed.', bad; END IF;
END $$;

UPDATE order_shipments s SET ledger_bill_id = m.bill_id, updated_at = now()
FROM marked m WHERE m.yes AND s.id = m.shipment_id AND s.ledger_bill_id IS NULL;

SELECT count(*) FILTER (WHERE m.yes) AS marked_y_now_billed, count(*) FILTER (WHERE NOT m.yes) AS marked_n_still_to_bill
FROM marked m;

COMMIT;
