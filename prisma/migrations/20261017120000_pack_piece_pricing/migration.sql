-- Pack / piece pricing. Each variant states whether the catalogue prints its price per
-- pack or per piece. unit_price_paise is the piece price and pack_price_paise the
-- authoritative pack price; scripts/seed/sync-pricing-from-omsonsdata.mjs fills both.
ALTER TABLE "product_variants" ADD COLUMN "price_basis" TEXT NOT NULL DEFAULT 'piece';
ALTER TABLE "product_variants" ADD COLUMN "pack_assumed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_basis_check" CHECK ("price_basis" IN ('pack', 'piece'));

-- Order lines snapshot the basis; existing lines keep NULL (they are never repriced).
ALTER TABLE "order_items" ADD COLUMN "price_basis" TEXT;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_basis_check" CHECK ("price_basis" IN ('pack', 'piece'));
