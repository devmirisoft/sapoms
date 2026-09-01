CREATE TABLE "slider_images" (
  "id" BIGSERIAL PRIMARY KEY,
  "title" TEXT,
  "image_url" TEXT NOT NULL,
  "cloudinary_public_id" TEXT NOT NULL UNIQUE,
  "position" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id" BIGINT REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "slider_images_is_active_position_idx" ON "slider_images"("is_active", "position");
CREATE INDEX "slider_images_position_idx" ON "slider_images"("position");