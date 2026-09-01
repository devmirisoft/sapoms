CREATE TABLE "order_item_dispatches" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "order_item_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "OrderFulfilmentStatus" NOT NULL DEFAULT 'DISPATCHED',
    "remark" TEXT,
    "actor_user_id" BIGINT,
    "actor_role" "UserRole",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_item_dispatches_order_id_created_at_idx" ON "order_item_dispatches"("order_id", "created_at");
CREATE INDEX "order_item_dispatches_order_item_id_created_at_idx" ON "order_item_dispatches"("order_item_id", "created_at");

ALTER TABLE "order_item_dispatches" ADD CONSTRAINT "order_item_dispatches_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_item_dispatches" ADD CONSTRAINT "order_item_dispatches_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
