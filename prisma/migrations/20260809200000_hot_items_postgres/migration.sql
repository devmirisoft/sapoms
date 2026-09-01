CREATE TABLE IF NOT EXISTS hot_items (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  badge TEXT NOT NULL DEFAULT 'Hot pick',
  sku_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  specs_snapshot TEXT NOT NULL DEFAULT '',
  image_snapshot TEXT NOT NULL DEFAULT '',
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS hot_items_product_id_variant_id_key
  ON hot_items(product_id, variant_id);

CREATE INDEX IF NOT EXISTS hot_items_position_idx
  ON hot_items(position);

CREATE INDEX IF NOT EXISTS hot_items_is_active_position_idx
  ON hot_items(is_active, position);
