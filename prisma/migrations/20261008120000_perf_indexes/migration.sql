-- CreateIndex
CREATE INDEX "orders_order_date_idx" ON "orders"("order_date");

-- CreateIndex
CREATE INDEX "orders_dealer_id_order_date_idx" ON "orders"("dealer_id", "order_date");

-- CreateIndex
CREATE INDEX "custom_discount_requests_staff_id_idx" ON "custom_discount_requests"("staff_id");
